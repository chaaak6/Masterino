#!/usr/bin/env python3
"""Create a disposable, dependency-free workspace for live presentation BDD."""

from __future__ import annotations

import binascii
import hashlib
import json
import struct
import sys
import zlib
from pathlib import Path


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xFFFFFFFF)


def make_png(path: Path) -> None:
    width = height = 32
    row = b"\x00" + b"\x2f\x80\xed" * width
    payload = b"\x89PNG\r\n\x1a\n"
    payload += png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    payload += png_chunk(b"IDAT", zlib.compress(row * height))
    payload += png_chunk(b"IEND", b"")
    path.write_bytes(payload)


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/masterino-ppt-bdd").resolve()
    root.mkdir(parents=True, exist_ok=True)
    make_png(root / "bdd-logo.png")
    protected = root / "protected.pptx"
    protected.write_bytes(b"MASTERINO-PPT-BDD-PROTECTED\n")
    skill = root / ".agents" / "skills" / "bdd-smoke"
    skill.mkdir(parents=True, exist_ok=True)
    (skill / "SKILL.md").write_text(
        "---\nname: bdd-smoke\ndescription: Return the fixed local BDD smoke marker.\n---\n\n"
        "When activated, return exactly: BDD-SKILL-SMOKE-OK\n",
        encoding="utf-8",
    )
    oracle = {
        "protectedSha256": hashlib.sha256(protected.read_bytes()).hexdigest(),
        "slides": 3,
        "texts": ["LOCAL-PPT-BDD-20260918", "Revenue", "Next steps"],
    }
    (root / "oracle.json").write_text(json.dumps(oracle, indent=2) + "\n", encoding="utf-8")
    print(root)


if __name__ == "__main__":
    main()
