# Local PowerPoint BDD results

- Date: 2026-09-18 (Asia/Shanghai)
- Candidate commit: `b80d0024`
- Electron profile: `test-server`
- Server: `https://mlai-test.bielcrystal.com`
- Execution target: local desktop (`desktop-dev`, macOS)
- Test topic: `tpc_zwS3l5yjhiD5`
- Test namespace: `masterino-test`
- Application image: `sha256:2c8d500dc3993641c8573696d65127b37d93d583d360a0f1c207f1c2e85fcaec`
- Device gateway image: `sha256:09485c35d03f7b4a4b1ebf1da5371bd05c6d3d6fd8de898392aa9af8c71ff609`

The scenarios in `local-presentation.feature` were exercised through the source Electron app with Computer Use against the test cluster. The topic was bound to an isolated local project directory and displayed `执行设备: 本机` throughout the run.

## Rich presentation creation

The agent used the local-system presentation APIs. Its visible tool history was:

1. `createPresentation` (the model first supplied an unsupported layout value, received validation feedback, and corrected it)
2. `createPresentation`
3. `validatePresentation`
4. `renderPresentationPreview`

The final validation reported `valid: true`, zero errors, zero warnings, three slides, one table, one chart, one image, and speaker notes. The preview renderer wrote three SVG slides under revision `r1`.

An independent OOXML verifier then inspected the generated file and returned:

```json
{"charts": 1, "images": 2, "notes": 3, "pptxSha256": "45bf1882efec98f8d1a6e2b5fa34719771564e72f7752e03c342225a8c7f2e35", "slides": 3, "tables": 1}
```

The generated deck contained the required `LOCAL-PPT-BDD-20260918` and `Next steps` text, the source image, the Quarter/Revenue table, the Revenue chart, the blue rounded rectangle, stable slide/element ids, and notes.

## Refusal to overwrite

The agent called `createPresentation` once for the existing `protected.pptx`. The local tool returned `EEXIST` and did not rename, delete, or replace the target. The fixture hash remained:

```text
b8634424b0a4676354c7c35183e84f7bf04ef7d669dd68c09ea43b480393932d
```

## Regression smoke tests

- Excel: `createOfficeDocument` created `smoke.xlsx`. Independent inspection returned `Quarter`, `Revenue`, `Q1`, `100` from the `Smoke` worksheet.
- Project skills: `activateSkill` loaded `bdd-smoke` and returned exactly `BDD-SKILL-SMOKE-OK`. An earlier attempt was interrupted by the test service before any skill call; the explicit retry completed normally.
- Basic chat: a separate test topic returned exactly `BDD-APP-SMOKE-OK`.

No production service was accessed or changed during this run.
