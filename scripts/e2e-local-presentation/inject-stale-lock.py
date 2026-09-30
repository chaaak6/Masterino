#!/usr/bin/env python3
"""Inject a dead-owner presentation lock for the live recovery scenario."""

from __future__ import annotations

import json
import socket
import sys
import time
from pathlib import Path


def main() -> None:
    project = Path(sys.argv[1]).resolve()
    if not project.name.endswith(".masterino.json") or not project.is_file():
        raise SystemExit("Pass an existing .masterino.json project path")
    lock = Path(f"{project}.lock")
    lock.write_text(
        json.dumps(
            {
                "createdAt": int(time.time() * 1000),
                "hostname": socket.gethostname(),
                "pid": 2_147_483_647,
                "token": "bdd-dead-owner",
                "version": 1,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    print(lock)


if __name__ == "__main__":
    main()
