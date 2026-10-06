# Temporary files BDD — 2026-10-06

Scope: directory management only. Use the packaged macOS test App, Chinese UI and
`https://mlai-test.bielcrystal.com`; no production state changes or deployment.

App: `apps/desktop/release/temporary-files-20261006/mac-arm64/Masterino.app`.
Fixture: `/Users/a10507479/Desktop/Masterino-PPT-BDD/temporary-files-20261006/用户项目`.
The project contains `input.txt` and `src/existing.py` before acceptance.

## Cases

1. In the selected project, request a one-page PPT made using Python, reading the
   existing input file. Observe writeFile/runCommand. Generator/check scripts and
   intermediates must be under `.masterino-tmp/<topic-id>/`; the PPT is at the root.
2. Ask to modify the PPT using the existing generator. It must reuse the topic
   directory; no new root-level Python files. Relative inputs/outputs still work.
3. Ask for a deliberately failing temporary script, then correct the same script.
   Failure must be visible, correction succeeds, and no root-level scripts appear.
4. Explicitly request a deliverable `src/deliverable.py`. It must remain at that
   user-requested path. Existing source must remain byte-for-byte unchanged.
5. Start another topic in the same project and generate another document. Topic
   directories must differ; the original topic's scripts must stay unchanged.
6. Without a selected project, request a small Python-produced document. The topic
   scratch workspace must use the same temporary-directory convention.

Inspect actual disk files independently after UI tool completion. Check the App
signature and packaged test endpoint. Automated boundary regressions additionally
cover temporary=true, older explicit-path schemas, invalid names/missing topics,
symlinked directories, and preservation of normal files and PPT sidecars.

## Results

Completed with the packaged macOS arm64 App via native Computer Use, Chinese UI,
DeepSeek V4 Flash Vision Exp, and the test cluster. Six cases passed:

| Case | Evidence |
| --- | --- |
| Project creation | `tpc_rPcCRSA92QGX`: make_deck.py and verify_deck.py in the topic temporary directory; one-page 目录验收.pptx at project root. The first prompt did not prescribe a temporary directory. |
| Reuse and intermediates | Same generator/check scripts updated in place; intermediate.txt alongside them; readback and independent slide XML confirm title 目录验收第二版 and input text. |
| Failure and recovery | failure_case.py first exited 1 with RuntimeError("目录失败验收"); a later request repaired the same file, exited 0 and printed 目录恢复成功. No root script or extra PPT appeared. |
| Source deliverable | Explicitly requested src/deliverable.py stays in src/, with exact requested content; not executed or relocated. |
| Second topic | `tpc_YZMSOMsrK0tc`: make_deck2.py in a different topic directory; 第二话题.pptx at root. All four first-topic files retain their recorded SHA-256 hashes. |
| No project | `tpc_5clPbSYIA9dw`: two scripts under scratch-workspaces/tpc_5clPbSYIA9dw/.masterino-tmp/tpc_5clPbSYIA9dw/, and 临时话题.pptx at that scratch workspace root. |

Independent filesystem inspection found no root-level .py files in either workspace.
The project root contains input.txt and two final PPTX files; requested source remains
in src/. The scratch root contains only its final PPTX and the managed directory.
All three PPTX ZIPs contain one slide with the expected Chinese text.
Original SHA-256 values remain unchanged:

- input.txt: a5ba258928c5b4e352b97c7005cd1884c5944bad0b5e752ef30a50e01ddc2889
- src/existing.py: d1013d2aebf44c82b5bd5fdc817de2ffdae615d039d00f078b9ce223f6d6c2de

`codesign --verify --deep --strict` passed after execution. The App remains available
and running for manual acceptance. Windows hidden attributes are covered by the
Windows test-build workflow, not claimed as macOS UI verification.

Build requirement: set DESKTOP_BUILD_FLAVOR=test for both main compilation and
packaging. The first package omitted that switch and reused the normal saved profile,
causing failed requests to its saved production URL before BDD. It was stopped and
rebuilt with the existing isolated masterino-desktop-test profile; all six actual BDD
cases ran after the test gateway authenticated successfully. No production state
operations were performed. The isolated profile's existing storage location is
masterino-desktop-test-server/lobehub-storage.

Automated validation before packaging: 236 related tests passed, root type checking,
focused lint and diff whitespace checks passed. The temporary-file suite includes
10 passing macOS cases and one Windows-only case skipped locally. No unrelated
feature matrix was rerun for this directory-only change.
