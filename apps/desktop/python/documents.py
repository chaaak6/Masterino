"""Bounded local document engine. Structured plans only; never executes caller SQL."""

import csv
import hashlib
import json
import math
import os
import pathlib
import sqlite3
import sys
import time
import threading
import zipfile
from lxml import etree
import duckdb

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
MAX_DISK = 4 * 1024**3


def peak_rss():
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t)
                for name in [
                    "PeakWorkingSetSize",
                    "WorkingSetSize",
                    "QuotaPeakPagedPoolUsage",
                    "QuotaPagedPoolUsage",
                    "QuotaPeakNonPagedPoolUsage",
                    "QuotaNonPagedPoolUsage",
                    "PagefileUsage",
                    "PeakPagefileUsage",
                ]
            ]

        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        if not ctypes.windll.psapi.GetProcessMemoryInfo(
            ctypes.c_void_p(-1), ctypes.byref(counters), counters.cb
        ):
            raise OSError("Unable to measure document worker memory")
        return counters.PeakWorkingSetSize
    import resource

    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (
        1 if sys.platform == "darwin" else 1024
    )


def bounded_metadata(z, member):
    if z.getinfo(member).file_size > 4 * 1024**2:
        raise ValueError("Workbook metadata exceeds 4 MiB budget")
    return etree.fromstring(
        z.read(member), parser=etree.XMLParser(resolve_entities=False, no_network=True)
    )


def progress(rows):
    print(json.dumps({"phase": "import", "rowsScanned": rows}), flush=True)


def ident(s):
    return '"' + s.replace('"', '""') + '"'


def connect(p):
    c = duckdb.connect(str(p))
    c.execute("SET memory_limit='256MB'")
    c.execute("SET threads=2")
    c.execute("SET preserve_insertion_order=false")
    return c


def shared_strings(z, root):
    db = sqlite3.connect(root / "strings.sqlite")
    db.execute("CREATE TABLE strings (id INTEGER PRIMARY KEY, value TEXT)")
    if "xl/sharedStrings.xml" in z.namelist():
        batch = []
        with z.open("xl/sharedStrings.xml") as stream:
            for i, (_, e) in enumerate(
                etree.iterparse(
                    stream,
                    events=("end",),
                    tag=NS + "si",
                    resolve_entities=False,
                    no_network=True,
                )
            ):
                batch.append((i, "".join(e.itertext())))
                if len(batch) == 5000:
                    db.executemany("INSERT INTO strings VALUES (?,?)", batch)
                    batch.clear()
                e.clear()
                while e.getprevious() is not None:
                    del e.getparent()[0]
            db.executemany("INSERT INTO strings VALUES (?,?)", batch)
    db.commit()
    return db


def import_source(args, root):
    source = pathlib.Path(args["path"]).resolve()
    st = source.stat()
    columns = args.get("columns", [])
    if not columns or len(columns) > 128 or len(set(columns)) != len(columns):
        raise ValueError("Select 1–128 distinct columns")
    if any(
        not isinstance(x, str)
        or not x.isascii()
        or not x.isalpha()
        or not x.isupper()
        or len(x) > 3
        for x in columns
    ):
        raise ValueError("Columns use Excel letters")
    key = hashlib.sha256(
        json.dumps(
            [
                str(source),
                st.st_size,
                st.st_mtime_ns,
                st.st_ctime_ns,
                columns,
                args.get("sheet"),
                args.get("start", 2),
                "schema-v2",
            ],
            sort_keys=True,
        ).encode()
    ).hexdigest()
    dataset = root / (key + ".duckdb")
    meta_path = root / (key + ".json")
    if dataset.exists() and meta_path.exists():
        return dataset, json.loads(meta_path.read_text()), 0
    dataset.unlink(missing_ok=True)
    pathlib.Path(str(dataset) + ".wal").unlink(missing_ok=True)
    if not isinstance(args.get("start", 2), int) or args.get("start", 2) < 1:
        raise ValueError("start must be a positive one-based row")
    work = root / (key + ".working")
    work.mkdir(exist_ok=True)
    spool = work / "rows.csv"
    count = 0
    date1904 = False
    headers = ["_row"] + [v for col in columns for v in (col, col + "__state")]
    try:
        with spool.open("w", newline="", encoding="utf-8") as target:
            writer = csv.writer(target)
            writer.writerow(headers)
            if source.suffix.lower() == ".xlsx":
                with zipfile.ZipFile(source) as z:
                    workbook = bounded_metadata(z, "xl/workbook.xml")
                    properties = workbook.find(NS + "workbookPr")
                    date1904 = properties is not None and properties.get(
                        "date1904"
                    ) in ("1", "true")
                    sheets = workbook.find(NS + "sheets")
                    selected = (
                        next(
                            (s for s in sheets if s.get("name") == args.get("sheet")),
                            None,
                        )
                        if args.get("sheet")
                        else sheets[0]
                    )
                    if selected is None:
                        raise ValueError("Worksheet not found")
                    rel_id = selected.get(
                        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
                    )
                    rels = bounded_metadata(z, "xl/_rels/workbook.xml.rels")
                    rel = next(r for r in rels if r.get("Id") == rel_id)
                    if rel.get("TargetMode") == "External":
                        raise ValueError("External worksheet is unsupported")
                    member = rel.get("Target").lstrip("/")
                    if not member.startswith("xl/"):
                        member = "xl/" + member
                    strings = shared_strings(z, work)
                    with z.open(member) as stream:
                        for _, row in etree.iterparse(
                            stream,
                            events=("end",),
                            tag=NS + "row",
                            resolve_entities=False,
                            no_network=True,
                        ):
                            if int(row.get("r", "0")) >= args.get("start", 2):
                                cells = {}
                                for cell in row:
                                    col = "".join(
                                        c for c in cell.get("r", "") if c.isalpha()
                                    )
                                    if col not in columns:
                                        continue
                                    typ = cell.get("t")
                                    v = cell.find(NS + "v")
                                    f = cell.find(NS + "f")
                                    value = (
                                        v.text
                                        if v is not None and v.text is not None
                                        else ""
                                    )
                                    state = (
                                        "error"
                                        if typ == "e"
                                        else (
                                            "cacheMissing"
                                            if f is not None and v is None
                                            else (
                                                "missing"
                                                if not value and typ != "inlineStr"
                                                else "valid"
                                            )
                                        )
                                    )
                                    if typ == "s" and value:
                                        found = strings.execute(
                                            "SELECT value FROM strings WHERE id=?",
                                            (int(value),),
                                        ).fetchone()
                                        if found is None:
                                            raise ValueError(
                                                "Invalid shared string index"
                                            )
                                        value = found[0]
                                    elif typ == "inlineStr":
                                        value = (
                                            "".join(cell.find(NS + "is").itertext())
                                            if cell.find(NS + "is") is not None
                                            else ""
                                        )
                                    cells[col] = (value, state)
                                writer.writerow(
                                    [row.get("r")]
                                    + [
                                        v
                                        for col in columns
                                        for v in cells.get(col, ("", "missing"))
                                    ]
                                )
                                count += 1
                                if count % 100000 == 0:
                                    target.flush()
                                    progress(count)
                                    if spool.stat().st_size > MAX_DISK:
                                        raise ValueError(
                                            "Document cache disk budget exceeded"
                                        )
                            row.clear()
                            while row.getprevious() is not None:
                                del row.getparent()[0]
                    strings.close()
            elif source.suffix.lower() == ".csv":
                with source.open(newline="", encoding="utf-8-sig") as stream:
                    for index, row in enumerate(csv.reader(stream), 1):
                        if index < args.get("start", 2):
                            continue
                        values = []
                        for col in columns:
                            n = 0
                            for ch in col.upper():
                                n = n * 26 + ord(ch) - 64
                            value = row[n - 1] if n <= len(row) else ""
                            values.extend((value, "valid" if value else "missing"))
                        writer.writerow([index] + values)
                        count += 1
                        if count % 100000 == 0:
                            target.flush()
                            progress(count)
                            if spool.stat().st_size > MAX_DISK:
                                raise ValueError("Document cache disk budget exceeded")
            else:
                raise ValueError("Dataset analysis supports xlsx and UTF-8 csv")
        after = source.stat()
        if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
            st.st_size,
            st.st_mtime_ns,
            st.st_ctime_ns,
        ):
            raise ValueError("Source changed during document scan; select it again")
        c = connect(dataset)
        c.execute(
            "CREATE TABLE data AS SELECT * FROM read_csv(?, header=true, all_varchar=true, nullstr='')",
            [str(spool)],
        )
        c.close()
        meta = {
            "columns": columns,
            "rows": count,
            "sourceVersion": f"{st.st_size}:{st.st_mtime_ns}",
            "source": str(source),
            "date1904": date1904,
            "numericEncoding": "Raw cached values; Excel date serials are not converted",
            "cachedFormulasOnly": True,
        }
        meta_path.write_text(json.dumps(meta), encoding="utf-8")
        return dataset, meta, 1
    except BaseException:
        dataset.unlink(missing_ok=True)
        meta_path.unlink(missing_ok=True)
        raise
    finally:
        import shutil

        shutil.rmtree(work, ignore_errors=True)


def analyze(c, args, meta):
    metrics = args.get("metrics", [])
    if not metrics or len(metrics) > 32:
        raise ValueError("Select 1–32 metrics")
    result = {}
    valid = []
    passed = []
    for metric in metrics:
        col = metric["column"]
        if col not in meta["columns"]:
            raise ValueError("Column is not in this dataset")
        name = metric.get("name", col)
        if not isinstance(name, str) or len(name) > 200 or name in result:
            raise ValueError("Metric names must be unique and at most 200 characters")
        value = "try_cast(" + ident(col) + " AS DOUBLE)"
        state = ident(col + "__state")
        ok = f"({state}='valid' AND isfinite({value}))"
        valid.append(ok)
        bounds = []
        for field, op in [("lower", ">="), ("upper", "<=")]:
            if field in metric:
                bound = metric[field]
                if (
                    isinstance(bound, bool)
                    or not isinstance(bound, (float, int))
                    or not math.isfinite(bound)
                ):
                    raise ValueError("Bounds must be finite numbers")
                bounds.append(f"{value}{op}{bound}")
        if (
            "lower" in metric
            and "upper" in metric
            and metric["lower"] > metric["upper"]
        ):
            raise ValueError("Lower bound exceeds upper bound")
        passed.extend(bounds)
        row = c.execute(
            f"""SELECT count(*) FILTER(WHERE {ok}), avg({value}) FILTER(WHERE {ok}), min({value}) FILTER(WHERE {ok}), max({value}) FILTER(WHERE {ok}), stddev_samp({value}) FILTER(WHERE {ok}), count(*) FILTER(WHERE {state}='cacheMissing'), count(*) FILTER(WHERE {state}='error'), count(*) FILTER(WHERE NOT coalesce({ok},false)) FROM data"""
        ).fetchone()
        result[name] = dict(
            zip(
                [
                    "validCount",
                    "mean",
                    "min",
                    "max",
                    "stddev",
                    "cacheMissingCount",
                    "errorCount",
                    "incompleteCount",
                ],
                row,
            )
        )
        result[name]["stddevDdoF"] = 1
        result[name].update(
            {"column": col, "lower": metric.get("lower"), "upper": metric.get("upper")}
        )
    complete = " AND ".join(valid)
    passes = " AND ".join(passed) or "true"
    row = c.execute(
        f"SELECT count(*) FILTER(WHERE ({complete}) AND ({passes})), count(*) FILTER(WHERE ({complete}) AND NOT ({passes})), count(*) FILTER(WHERE NOT coalesce(({complete}),false)) FROM data"
    ).fetchone()
    return {
        "metrics": result,
        "classification": dict(zip(["pass", "fail", "incomplete"], row)),
    }


def query(c, args, meta):
    groups = args.get("groupBy", [])
    distinct = args.get("distinct", [])
    metrics = args.get("metrics", [])
    if len(groups) > 8 or len(distinct) > 32 or len(metrics) > 32:
        raise ValueError("Too many query columns")
    for col in groups + distinct + [m["column"] for m in metrics]:
        if col not in meta["columns"]:
            raise ValueError("Column is not in this dataset")
    limit = min(max(int(args.get("limit", 100)), 1), 1000)
    predicates = []
    parameters = []
    operators = {"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
    filters = args.get("filters", [])
    if len(filters) > 32:
        raise ValueError("At most 32 filters")
    for f in filters:
        col = f["column"]
        op = f["op"]
        if col not in meta["columns"]:
            raise ValueError("Column is not in this dataset")
        if op == "isMissing":
            predicates.append(ident(col + "__state") + " <> 'valid'")
            continue
        if op not in operators:
            raise ValueError("Unsupported filter")
        value = f["value"]
        if (
            not isinstance(value, (str, float, int))
            or isinstance(value, str)
            and len(value) > 2000
        ):
            raise ValueError("Invalid filter value")
        expression = ident(col)
        if isinstance(value, (float, int)):
            if not math.isfinite(value):
                raise ValueError("Filter must be finite")
            expression = "try_cast(" + expression + " AS DOUBLE)"
        predicates.append(expression + " " + operators[op] + " ?")
        parameters.append(value)
    where = " WHERE " + " AND ".join(predicates) if predicates else ""
    c.sql("SELECT * FROM data" + where, params=parameters).create_view("selected")
    result = {
        "sourceScans": 0,
        "rowsScanned": meta["rows"],
        "matchedRows": c.execute("SELECT count(*) FROM selected").fetchone()[0],
        "complete": True,
    }
    if distinct:
        result["distinctCount"] = c.execute(
            "SELECT count(*) FROM (SELECT DISTINCT "
            + ",".join(map(ident, distinct))
            + " FROM selected)"
        ).fetchone()[0]
    if groups:
        keys = ",".join(map(ident, groups))
        metric_sql = []
        for m in metrics:
            col = m["column"]
            value = f"try_cast({ident(col)} AS DOUBLE)"
            ok = f"{ident(col+'__state')}='valid' AND isfinite({value})"
            metric_sql.extend(
                [f"avg({value}) FILTER(WHERE {ok})", f"count(*) FILTER(WHERE {ok})"]
            )
        rows = c.execute(
            "SELECT "
            + keys
            + ",count(*)"
            + (" ," + ",".join(metric_sql) if metric_sql else "")
            + " FROM selected GROUP BY "
            + keys
            + " ORDER BY count(*) DESC,"
            + keys
            + " LIMIT ?",
            [limit + 1],
        ).fetchall()
        result["truncated"] = len(rows) > limit
        result["groups"] = []
        for r in rows[:limit]:
            key = list(r[: len(groups)])
            if any(isinstance(v, str) and len(v) > 2000 for v in key):
                raise ValueError(
                    "Group key exceeds output budget; select another grouping"
                )
            g = {"key": key, "rows": r[len(groups)], "means": {}, "validCounts": {}}
            for i, m in enumerate(metrics):
                name = m.get("name", m["column"])
                g["means"][name] = r[len(groups) + 1 + 2 * i]
                g["validCounts"][name] = r[len(groups) + 2 + 2 * i]
            if len(json.dumps(result)) + len(json.dumps(g)) > 24000:
                result["truncated"] = True
                break
            result["groups"].append(g)
    if args.get("sampleLimit"):
        count = min(max(int(args["sampleLimit"]), 1), 20)
        result["samples"] = []
        for row in c.execute(
            "SELECT * FROM selected ORDER BY try_cast(_row AS BIGINT) LIMIT ?", [count]
        ).fetchall():
            sample = {
                "row": int(row[0]),
                "cells": {
                    col: {
                        "value": (
                            row[1 + i * 2][:256] if row[1 + i * 2] else row[1 + i * 2]
                        ),
                        "state": row[2 + i * 2],
                    }
                    for i, col in enumerate(meta["columns"])
                },
            }
            if len(json.dumps(result)) + len(json.dumps(sample)) > 24000:
                result["samplesTruncated"] = True
                break
            result["samples"].append(sample)
    return result


def main(request):
    root = pathlib.Path(request["cacheRoot"])
    args = request["args"]
    op = request["operation"]
    if op == "analyzeSpreadsheet":
        dataset, meta, scans = import_source(args, root)
    else:
        dataset = pathlib.Path(args["datasetPath"]).resolve()
        if dataset.parent != root.resolve() or dataset.suffix != ".duckdb":
            raise ValueError("Dataset is outside document cache")
        meta = json.loads(dataset.with_suffix(".json").read_text())
        scans = 0
    c = connect(dataset)
    try:
        if op == "analyzeSpreadsheet":
            result = analyze(c, args, meta)
        elif op == "querySpreadsheet":
            result = query(c, args, meta)
        elif op == "exportDocumentReport":
            import xlsxwriter

            result = analyze(c, args, meta)
            output = pathlib.Path(args["outputPath"])
            if output.suffix.lower() != ".xlsx":
                raise ValueError("Report output must be .xlsx")
            if output.exists():
                raise ValueError("Report output already exists")
            book = xlsxwriter.Workbook(
                str(output),
                {
                    "constant_memory": True,
                    "strings_to_formulas": False,
                    "strings_to_urls": False,
                },
            )
            sheet = book.add_worksheet("Analysis")
            sheet.write_row(
                0,
                0,
                [
                    "Metric",
                    "Valid",
                    "Mean",
                    "Min",
                    "Max",
                    "Sample standard deviation",
                    "Incomplete",
                    "Column",
                    "Lower limit",
                    "Upper limit",
                ],
            )
            for i, (name, m) in enumerate(result["metrics"].items(), 1):
                sheet.write_row(
                    i,
                    0,
                    [
                        name,
                        m["validCount"],
                        m["mean"],
                        m["min"],
                        m["max"],
                        m["stddev"],
                        m["incompleteCount"],
                        m["column"],
                        m["lower"],
                        m["upper"],
                    ],
                )
            i = len(result["metrics"]) + 2
            sheet.write_row(i, 0, ["Rows", meta["rows"]])
            sheet.write_row(
                i + 1,
                0,
                [
                    "Pass",
                    result["classification"]["pass"],
                    "Fail",
                    result["classification"]["fail"],
                    "Incomplete",
                    result["classification"]["incomplete"],
                ],
            )
            book.close()
            result["outputPath"] = str(output)
        else:
            raise ValueError("Unsupported operation")
        result.update(
            {
                "datasetPath": str(dataset),
                "rowsScanned": meta["rows"],
                "sourceVersion": meta["sourceVersion"],
                "sourceScans": scans,
                "complete": True,
                "date1904": meta["date1904"],
                "numericEncoding": meta["numericEncoding"],
                "cachedFormulasOnly": True,
            }
        )
        result["peakRssBytes"] = peak_rss()
        return result
    finally:
        c.close()


if __name__ == "__main__":
    request = json.loads(pathlib.Path(sys.argv[1]).read_text())
    stopped = threading.Event()

    def watch_memory():
        while not stopped.wait(0.5):
            if peak_rss() > 768 * 1024**2:
                pathlib.Path(request["resultPath"]).write_text(
                    json.dumps(
                        {
                            "error": "Document worker exceeds 768 MiB resident memory budget"
                        }
                    ),
                    encoding="utf-8",
                )
                os._exit(0)

    threading.Thread(target=watch_memory, daemon=True).start()
    try:
        result = main(request)
    except Exception as e:
        result = {"error": str(e)}
    stopped.set()
    pathlib.Path(request["resultPath"]).write_text(
        json.dumps(result, allow_nan=False), encoding="utf-8"
    )
