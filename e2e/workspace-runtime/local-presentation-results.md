# Local PowerPoint BDD results

- Date: 2026-09-29 (Asia/Shanghai)
- Candidate commit: `a24d9563`
- Electron profile: `test-server`
- Server: `https://mlai-test.bielcrystal.com`
- Execution target: local desktop (source Electron app, macOS)
- Interface language: 简体中文
- Test topic: `tpc_Ut6dpHmNosfA`
- Test project: `/private/tmp/masterino-ppt-bdd-20260929-125900`
- Test namespace: `masterino-test`
- Application image: `sha256:cb1e4272e1f1ed79c5996506cf2edb7e83e609957873aa73524b8a5177188b04`
- Device gateway image: `sha256:09485c35d03f7b4a4b1ebf1da5371bd05c6d3d6fd8de898392aa9af8c71ff609`

The scenarios in `local-presentation.feature` were exercised through the source Electron app with Computer Use against the test cluster. The topic was locked to the isolated local project above and displayed `执行设备: 本机`. The verifier oracle was stored outside the project so the agent could not read expected hashes or assertions.

## Built-in PowerPoint tool flow

The visible tool history confirmed that PowerPoint work stayed in the local-system suite:

1. `createPresentation` created a three-slide PPTX and revision-1 sidecar.
2. `inspectPresentation`, `validatePresentation`, and `renderPresentationPreview` inspected the structure, reported `valid: true` with zero errors, and generated all three SVG previews.
3. `revisePresentation` updated the original PPTX in place from revision 1 to 2. The operations used top-level `elementId + patch`; one patch changed title text and the other changed only `source.path` to `replacement-logo.png`.
4. A second in-place `revisePresentation` recovered a lock owned by a dead process, advanced revision 2 to 3, and removed the stale lock.
5. The final `inspectPresentation`, `validatePresentation`, and `renderPresentationPreview` calls reported revision 3, zero errors, zero warnings, and wrote all three previews under `r3`.

The model selected the intended built-in tools without shell, Python, or a cloud sandbox. Once the prompt stated the `updateElement` shape explicitly, the revise flow completed in one call. The initial natural creation did produce one non-blocking `TEXT_MAY_OVERFLOW` warning and the model made unnecessary failed revise attempts before the follow-up told it to accept the warning. This is a model/tool-guidance usability issue rather than an execution failure; the shorter revised title eliminated the warning.

An independent OOXML verifier inspected the final file and returned:

```json
{"charts": 1, "images": 2, "notes": 3, "pptxSha256": "ed0dae58d87c320cd47db230231f0f91ed28716a9261c6147e8588a79fa1e5fe", "slides": 3, "tables": 1}
```

The final deck contains `LOCAL-PPT-BDD-LOCK-RECOVERED-20260929`, the replacement image, the Quarter/Revenue table, the Revenue chart, the blue rounded rectangle, stable slide/element ids, and notes on all three slides.

## Safety and concurrency checks

- Unrelated existing output: `revisePresentation` returned `PRESENTATION_OUTPUT_EXISTS` for `protected.pptx`. Its SHA-256 remained `b8634424b0a4676354c7c35183e84f7bf04ef7d669dd68c09ea43b480393932d`, and the project stayed at revision 3.
- Optimistic locking: an in-place revision with stale `expectedRevision: 2` returned `PRESENTATION_REVISION_CHANGED: expected 2, current 3`. The PPTX SHA-256 and sidecar revision remained unchanged.
- Untrusted slide id: `renderPresentationPreview` with only `../../outside` returned `slides: []`. Independent filesystem checks found no `outside.svg` in `/private/tmp`, the project root, or the preview tree.
- Crash recovery: a valid dead-owner lock was injected before the revision-3 operation. The local tool reclaimed it, completed the revision, and left no lock file behind.

## Regression smoke tests

- Excel: `createOfficeDocument` created `smoke.xlsx` with one `Smoke` worksheet. Independent ZIP/XML inspection returned `Quarter`, `Revenue`, `Q1`, and `100`.
- Project skills: `activateSkill` loaded `bdd-smoke` and returned exactly `BDD-SKILL-SMOKE-OK` without invoking Office tools.
- Basic chat: the same topic returned exactly `CHAT-SMOKE-OK` without invoking tools.

No production service was accessed or changed during this run. The source Electron test app remains running with the test-server profile for manual follow-up.
