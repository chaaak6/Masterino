# Packaged runtime / directory acceptance — 2026-10-06

Mac acceptance used the existing packaged arm64 test App at
`apps/desktop/release/temporary-files-20261006/mac-arm64/Masterino.app`, native
Computer Use, Chinese UI and the test cluster. Topic: `tpc_NVOmTXWhxo62`.
Workspace: `/Users/a10507479/Desktop/Masterino-PPT-BDD/temporary-files-20261006/用户项目`.
No production operations or deployment.

## Results

- Existing project `.venv/bin/python` used the host CPython 3.14.7 and project prefix.
  Bare python3 resolved to the existing pyenv 3.14.7 installation. git resolved to
  /usr/bin/git (2.39.5), node to the existing nvm v24.19.0 executable.
- The same conversation used the App's CPython 3.12.14 for a two-page PPT with a
  coloured-header table. `build slides.py` and `read back.py` contain spaces and
  reside in `.masterino-tmp/tpc_NVOmTXWhxo62/`. Runtime execution uses -I -B -X utf8.
- Output: reports/综合验收.pptx. Follow-up reused both scripts and changed 华东's
  value from 120 to 125. No root-level Python files appeared.
- WPS opened the final PPT without a repair dialog. Both slides and the coloured
  table with 125/100 render correctly. PowerPoint could not launch on this machine
  (installed binary is x86_64, LaunchServices returned -10669); no software was
  installed to change that host condition.
- Explicit source delivery src/own_example.py stays in src/. Original input.txt and
  src/existing.py retain the SHA-256 values recorded in temporary-files BDD.
- A separate createPresentation produced reports/sidecar-check.pptx and
  reports/sidecar-check.pptx.masterino.json side by side. Python-generated PPTs do
  not have a scene-graph sidecar; no fake sidecar was created for them.
- Fresh ordinary-command checks found zero python-runtime entries in PATH and no
  PYTHONDONTWRITEBYTECODE. The first model summary incorrectly said a runtime
  directory was present late in PATH; a targeted check corrected that summary.
- `heartbeat writer.py` ignored SIGTERM and appended at 0.2s intervals.
  killCommand stopped sh-29 / PID 23657; independent ps found no process and the
  heartbeat stopped growing. Reusing the same script started sh-31 / PID 25522.
  Cmd+Q exited the App (PID 14941) and its Python. After exit and restart, the
  heartbeat stayed exactly 38,367 bytes, mtime 1791270122; neither old PID exists.
- All 2,923 files of the packaged python-runtime have identical SHA-256 hashes
  before/after acceptance (no added/modified files). App signature verification
  passed. No pip installation was performed. The test App was restarted and left
  available for manual testing.

## Windows evidence / additional coverage

The existing Windows test build passed the hidden-attribute test and process-tree
termination tests. It uses attrib +H for .masterino-tmp. Bundled execution calls
spawn with an argument array and shell:false; ordinary commands do not receive the
runtime directory on PATH. Controller tests cover app-owned isolation flags and
ordinary-command environment separation.

Added runtime-routing.test.ts uses the actual packaged Python with a workspace,
script name and argument containing spaces/Chinese. It checks isolated import of
pptx, the output file and unchanged node executable/PATH/bytecode environment plus
working git before/after Python. The Windows test workflow runs it after packaging
with the packaged python.exe. This is real Windows process testing, not a Windows
Electron UI acceptance claim.

Local results: 13 passed, one Windows-only hidden-attribute case skipped; focused
lint and whitespace checks passed. The integration test allows 20 seconds because
macOS login-shell PATH discovery alone can take up to five seconds. No product
runtime changes were required by this acceptance round.
