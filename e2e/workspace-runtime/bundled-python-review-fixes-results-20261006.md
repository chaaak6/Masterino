# Python/PPT review fixes acceptance — 2026-10-06

Only the packaged macOS arm64 test App and mlai-test.bielcrystal.com were used. Production was not inspected or changed.

## Actual Computer Use acceptance

App: `apps/desktop/release/review-fixes-20261006/mac-arm64/Masterino.app`; Chinese UI, existing test login, DeepSeek V4 Flash Vision Exp.

- `tpc_h5RFTssxjsIn`: metadata listed all five pinned packages without additional discovery; writeFile/runCommand created a three-slide Chinese PPT with a dark-blue cover, native chart (100/120 and data labels), colored-header table and Chinese notes. Independent ZIP inspection confirmed three slides, one chart, three notes, title/table strings and data labels. Node v24.19.0 and Apple Git 2.39.5 succeeded. Ordinary-command PATH began with the existing host `.local/bin`; PYTHONDONTWRITEBYTECODE and MASTERINO_PYTHON_ENVIRONMENT were undefined.
- This acceptance caught a real defect: the existing workspace environment filter dropped the application-generated MASTERINO_ variable. A failing controller regression reproduced it; trusted runtime environment composition fixed it. The App was rebuilt, actually exited, and restarted before final verification.
- Final build, `tpc_4NqLhAt7PaNB`: actual bundled-script output reported isolated=1, dont_write_bytecode=1, utf8_mode=1 and project environment key `1ad3a6abfc173072`. PIP_CONSTRAINT pointed to that same directory and contained the five exact package versions. A different topic used a different key. The script regenerated and read back the three-slide PPT successfully. Git still worked.
- Existing Excel tools (createOfficeDocument / inspectOfficeDocument / readOfficeDocument) created review_excel.xlsx and read/aggregated 10+20=30. Independent sheet XML confirmed both values. Python was not used for this Excel smoke test.
- Final build background exit test: writeFile created review_quit.py, runtime=bundled-python started PID 41337 / sh-4 with SIGTERM ignored and a 90-second delayed marker. Computer Use quit the App before the delay elapsed. PID disappeared and marker remained absent; no external kill was used. The App was restarted for the user.
- Existing-project policy answer correctly preferred the repository's .venv for its tests; no repository test was executed through the App.

## Packaging defect reproduced and corrected

The first test package failed before App initialization with TypeError: a is not a function. proper-lockfile expects signal-exit 3.x's callable export, but desktop externalization loaded hoisted 4.x's object export. The main build now bundles each consumer's resolved signal-exit version. Both subsequent packaged launches reached the Chinese homepage and authenticated with the test gateway. This was not a keychain failure.

Strict deep codesign verification passed. Four actual Python integration tests passed inside the rebuilt package (imports, isolation, rich PPT round-trip and extra dependencies), before the final main-only environment correction; the Python resource is unchanged by that correction. The final package's real agent execution tested the corrected Node-to-Python path.

## Automated regression

- Desktop Python/controller/App: 16 tests passed, including the trusted environment propagation regression.
- Presentation: 12 tests passed, including changed-output crash recovery with concurrent contenders and exact non-text shape counting.
- Local shell process manager: 18 tests passed; runner: 20 passed; process-tree: 2 passed; presentation boundary: 6 passed; environment: 6 passed.
- One parallel local runner run timed out in its first login-shell discovery test under concurrent build/test load. An isolated rerun passed all 20 without code/test changes.
- Full root typecheck passed before the final runtimeEnv wiring; a final root typecheck is also run after that wiring. CI status is reported on the PR separately.

## Limits

This is a focused follow-up acceptance, not a repeat of the historical full BDD matrix. Windows UI acceptance, visual rendering of this new three-slide deck, arbitrary imported SmartArt/OLE/animations, new dependency installation and hostile stale-lock recovery were not re-exercised through Computer Use. Those are not claimed as new BDD passes. Changed-output/concurrent recovery and unauthorized old output rejection were covered by unit tests. Generic shell commands remain capable of arbitrary scripts; the runtime selector enforces isolation when selected and does not parse/rewrite all shell commands.
