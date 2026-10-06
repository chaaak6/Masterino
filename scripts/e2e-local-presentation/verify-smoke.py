#!/usr/bin/env python3
"""Independently verify the negative and Excel BDD artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree


def all_text(xml: bytes) -> list[str]:
    root = ElementTree.fromstring(xml)
    return [node.text or "" for node in root.iter() if node.tag.endswith(("}t", "}v"))]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--oracle", type=Path, required=True)
    parser.add_argument("--protected", type=Path, required=True)
    parser.add_argument("--xlsx", type=Path, required=True)
    args = parser.parse_args()
    oracle = json.loads(args.oracle.read_text(encoding="utf-8"))
    protected_hash = hashlib.sha256(args.protected.read_bytes()).hexdigest()
    assert protected_hash == oracle["protectedSha256"], protected_hash

    with zipfile.ZipFile(args.xlsx) as archive:
        names = archive.namelist()
        texts: list[str] = []
        for name in names:
            if name == "xl/sharedStrings.xml" or name.startswith("xl/worksheets/sheet"):
                texts.extend(all_text(archive.read(name)))
    for expected in ["Quarter", "Revenue", "Q1", "100"]:
        assert expected in texts, (expected, texts)
    print(json.dumps({"excelValues": ["Quarter", "Revenue", "Q1", "100"], "protectedSha256": protected_hash}, sort_keys=True))


if __name__ == "__main__":
    main()
