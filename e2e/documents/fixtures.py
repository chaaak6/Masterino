import sys, zipfile, os

root = sys.argv[1]
os.makedirs(root, exist_ok=True)
base = {
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><sheets><sheet name="Data" r:id="r1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
}
for kind in ["known", "expanded", "million"]:
    with zipfile.ZipFile(
        os.path.join(root, kind + ".xlsx"), "w", zipfile.ZIP_DEFLATED, compresslevel=1
    ) as z:
        for k, v in base.items():
            z.writestr(k, v)
        z.writestr(
            "xl/sharedStrings.xml",
            '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>name</t></si><si><t>value</t></si><si><t>category</t></si><si><t>alpha</t></si><si><t>beta</t></si></sst>',
        )
        with z.open("xl/worksheets/sheet1.xml", "w", force_zip64=True) as f:
            f.write(
                b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C1000001"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
            )
            if kind == "expanded":
                for _ in range(1025):
                    f.write(b" " * (1024 * 1024))
            else:
                n = 1000000 if kind == "million" else 5
                batch = []
                for i in range(n):
                    r = i + 2
                    value = [
                        "<v>8</v>",
                        "<f>5+5</f><v>10</v>",
                        "<v>12</v>",
                        "<f>1+1</f>",
                        "<v>#N/A</v>",
                    ][i % 5]
                    typ = ' t="e"' if i % 5 == 4 else ""
                    batch.append(
                        f'<row r="{r}"><c r="A{r}" t="inlineStr"><is><t>ID{i%3}</t></is></c><c r="B{r}"{typ}>{value}</c><c r="C{r}" t="s"><v>{3+i%2}</v></c></row>'
                    )
                    if len(batch) == 5000:
                        f.write("".join(batch).encode())
                        batch = []
                f.write("".join(batch).encode())
            f.write(b"</sheetData></worksheet>")

with open(os.path.join(root, "known.csv"), "w", encoding="utf-8") as f:
    f.write(
        "id,measurement,category\nfirst,8,alpha\nsecond,10,beta\nthird,12,alpha\nfourth,,beta\nfifth,invalid,alpha\n"
    )
