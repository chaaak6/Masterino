"""Build the platform-local, standalone PowerPoint worker for Electron resources."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DESKTOP = ROOT.parent.parent
TARGET = DESKTOP / "resources" / "ppt-runtime"


def main():
    if sys.version_info[:2] != (3, 12):
        raise SystemExit("Build the worker with Python 3.12")
    with tempfile.TemporaryDirectory(prefix="masterino-ppt-build-") as folder:
        env = Path(folder) / "venv"
        subprocess.run([sys.executable, "-m", "venv", str(env)], check=True)
        python = env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        subprocess.run(
            [str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(ROOT / "requirements.txt")],
            check=True,
        )
        subprocess.run([str(python), "-m", "unittest", "-v", "test_worker"], cwd=ROOT, check=True)
        subprocess.run(
            [
                str(python), "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
                "--name", "ppt-worker", "--distpath", str(TARGET),
                "--workpath", str(Path(folder) / "work"),
                "--specpath", str(Path(folder) / "spec"), str(ROOT / "worker.py"),
            ],
            check=True,
        )
        binary = TARGET / "ppt-worker" / ("ppt-worker.exe" if os.name == "nt" else "ppt-worker")
        subprocess.run(
            [str(python), "-m", "unittest", "-v", "test_worker"],
            cwd=ROOT,
            env={**os.environ, "PPT_WORKER_BINARY": str(binary)},
            check=True,
        )
    output = subprocess.check_output([str(binary), "health"], text=True).strip()
    if '"pythonPptx": true' not in output:
        raise SystemExit(f"Worker health check failed: {output}")
    print(f"Built standalone worker: {binary}")


if __name__ == "__main__":
    main()
