# Local document implementation acceptance — 2026-10-09

Base: `origin/main` at `6f085b5ee0ffbddb12a90b862321a821263a3006`. Branch: `codex/local-document-processing`. All fixtures are synthetic. The isolated desktop profile uses `https://mlai-test.bielcrystal.com`; the explicit `masterino-documents-test` cluster context passed the live test-environment readiness check. No production deployment, production configuration changes, or production document processing occurred.

## Delivered behavior

- Non-image attachments above10 MiB transfer in1 MiB IPC chunks, with a4 GiB supported size cap. Binding, preparation and integrity verification stream bytes and reuse verified digests when the file identity is unchanged.
- Metadata preflight inspects OOXML compressed/expanded sizes, sheets and PDF pages before choosing bounded reads or a dataset. Existing Office readers and generation tools remain available.
- Selected XLSX/UTF-8 CSV columns stream into a disk dataset. Later grouping, exact distinct counts, structured filters, row evidence and reports reuse `datasetId` without reparsing the source. Cached formulas, errors and missing measurements remain distinguishable; dates remain raw serials.
- Heavy operations return conversation/device-owned jobs with progress, polling and cancellation. One heavy job runs at a time, with bounded worker memory, time and per-conversation disk budgets. Later jobs sweep expired caches, including inactive conversations.
- PDF metadata, selected-page text, page-number search evidence and PNG rendering use the existing PDF.js/Canvas engine through ranged local reads. Completed rendered pages receive exact-file preview tokens. Blank text indicates possible OCR need.
- XLSX and optional PDF reports share the dataset/metric plan. Reports publish only to new authorized output paths. PDF output is read back before publication; occupied destinations cannot overwrite files or leave a partial report pair.

The only new runtime package is pinned `duckdb==1.5.6` in the existing bundled Python. The existing PDF package supplies a136 KiB Liberation font and license. No default OCR, LibreOffice, Python installer or PDF CLI installation is required. Users receive these dependencies through the normal desktop bundle.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Cucumber using the freshly built bundled Python |9 scenarios /30 steps passed |
| Real Electron parser, reports, ownership, cache expiry and started-scan cancellation |2 scenarios passed |
| Full test App: renderer/preload/controller/boundary/worker/runtime, including preview loading |8 acceptance lanes passed |
| Existing Office/PPT, attachments, executor, client and execution-boundary regressions |106 assertions passed |
| Existing desktop Gateway/LocalFile/readFile regressions |144 assertions passed |
| Bundled Python standard acceptance, before and after relocation |4 checks passed at each location |
| Root TypeScript and Git whitespace checks | Passed |

Fixtures cover a workbook expanding beyond1 GiB, a million-row workbook, cached/missing/error formula values, known pass/fail/incomplete counts, UTF-8 CSV filters, group truncation, exact distinct counts,101 MiB attachment transfer, existing Office bounded reads, PDF pages/search and Chinese report text. XLSX report values are checked directly in its OOXML. Cancellation occurs after scan progress starts and must allow a normal read within5 seconds.

Measured macOS arm64 million-row run:

| Operation | Time | Peak process RSS | Result size |
| --- | --- | --- | --- |
| Existing Office grouped aggregate |22.560 s | Not measured |337 bytes |
| New cold dataset plus metric analysis |17.175 s |186.6 MiB |665 bytes |
| Reused dataset grouping plus exact distinct |0.095 s |64.4 MiB |1043 bytes |

The cold operations calculate different statistics; these are indicative timings, not an equivalent-work speedup ratio. Dataset reuse is the main repeated-query benefit. Fixtures and measurements are hardware-specific. The4 GiB attachment cap was validated through boundary behavior; an actual4 GiB transfer was not run.

The complete desktop TypeScript command remains blocked by existing errors in unchanged sources, tests and declarations; the changed document/runtime/controller files report no errors. The root check passes. Windows packaging paths are implemented but were not executed on this Mac. Unicode reports require the fixed local OS font and fail verification if unavailable. Scanned PDFs require a separate, explicitly chosen OCR workflow; Excel formula recalculation is not provided.

Reproduction commands and generated artifact locations are in [README.md](README.md).

## PR review fixes — 2026-10-09

All four review findings were reproduced through behavior checks and fixed:

- XLSX classification now contains exactly `Pass,1,Fail,2,Incomplete,2` for the known fixture, with no metric-only headers inserted between its labels and counts.
- Document workers use the existing `ShellProcessManager`. On Unix each worker owns a process group and its Python child stays in that group; on Windows cleanup uses the existing process-tree termination. App quit awaits both Shell and document cleanup, including worker closure and active-job cleanup, and refuses new document jobs during shutdown. The Shell manager implementation itself is unchanged.
- The legacy bundled Python probe no longer imports or requires DuckDB metadata. Only the three spreadsheet/dataset/report operations use the separate optional-engine probe. Failed optional probes can retry; PDF inspection/read/search/render do not require a Python probe.
- The desktop advertises all nine document API contract versions. The service scopes those APIs to a selected desktop advertising the complete workflow; old or partial desktops retain historical Office and presentation behavior without receiving unsupported document calls.

Final isolated-test results: Cucumber13 scenarios/43 steps passed; real Electron4 scenarios passed; full test App9 acceptance lanes passed, including actual App quit;135 shared/server regressions and150 desktop regressions passed. One Windows-specific runtime-routing check was skipped on macOS. Root TypeScript and whitespace checks pass. The separate desktop TypeScript command still reports the previously recorded baseline errors, including unchanged portions of App.ts; there are no new document-fix diagnostics.

Fault injection only changes disposable runtime copies: DuckDB import raises an error and its distribution metadata is absent, while a real legacy PPT round trip and PDF read/search/render remain successful. After repairing that copy, dataset creation, query and report export work. The quit fixture ignores SIGTERM to require process-group escalation; the unfixed implementation left Python alive after Electron exit, while the fix reaps it before exit. A separate App lifecycle check verifies that completing Shell cleanup alone cannot complete quit while document cleanup is pending. The full production-entry test also starts scanning, quits the verified isolated profile and observes no residual Python process.

No production App runtime, production cluster resources or production deployment were modified. The original worktree remains untouched; changes are confined to this PR worktree and temporary test artifacts.
