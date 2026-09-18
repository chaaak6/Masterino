#!/usr/bin/env python3
"""Independently inspect generated OOXML without importing product code."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree


def text_in(xml: bytes) -> str:
    root = ElementTree.fromstring(xml)
    return " ".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pptx", type=Path)
    parser.add_argument("--oracle", type=Path, required=True)
    parser.add_argument("--project", type=Path, required=True)
    args = parser.parse_args()
    oracle = json.loads(args.oracle.read_text(encoding="utf-8"))
    project = json.loads(args.project.read_text(encoding="utf-8"))

    with zipfile.ZipFile(args.pptx) as archive:
        names = archive.namelist()
        slide_names = sorted(
            (name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
            key=lambda name: int(re.search(r"\d+", name).group()),
        )
        all_text = " ".join(text_in(archive.read(name)) for name in slide_names)
        facts = {
            "charts": sum(bool(re.fullmatch(r"ppt/charts/chart\d+\.xml", name)) for name in names),
            "images": sum(name.startswith("ppt/media/") for name in names),
            "notes": sum(bool(re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", name)) for name in names),
            "slides": len(slide_names),
            "tables": sum(b"<a:tbl>" in archive.read(name) for name in slide_names),
        }

    assert facts["slides"] == oracle["slides"], facts
    assert facts["charts"] >= 1, facts
    assert facts["images"] >= 1, facts
    assert facts["tables"] >= 1, facts
    assert facts["notes"] >= 1, facts
    for marker in oracle["texts"]:
        assert marker in all_text, (marker, all_text)
    assert project["schemaVersion"] == 1 and project["revision"] >= 1
    assert len(project["deck"]["slides"]) == oracle["slides"]
    print(json.dumps({"pptxSha256": hashlib.sha256(args.pptx.read_bytes()).hexdigest(), **facts}, sort_keys=True))


if __name__ == "__main__":
    main()
