# Web Skill boundary acceptance — 2026-09-09

Environment: `https://mlai-test.bielcrystal.com`; deployment reported by parent: `d0cd5d22`.

## Real authenticated UI evidence (before fix)

Created only this synthetic topic through the existing Chrome test-site session:
`/agent/agt_RIC1WM1Wad0v/tpc_lqxlov0ZlrvM`.

Requested activation of `office-documents`, then reading a bundled reference if available. Explicitly prohibited scripts, file creation, and business-content access. The topic UI displayed execution target “无设备”.

The persisted assistant message `msg_VBMtOVwy5ot1qUtLRK` declared `lobe-skills.activateSkill`, arguments `{"name":"office-documents"}`, call ID `call_00_9gL8KRaPhaULWqidqhNz3656`. Persisted tool message `msg_uQ0fHE9UAg35` had the matching parent, plugin, API, call ID, and arguments, but returned `SKILL_SANDBOX_BINDING_REQUIRED` with null state. This is a real tool failure, not merely the model describing an error. See `web-skill-boundary-before-fix.json`.

No Skill ID or reference content was returned. Normal activation/read-reference acceptance is **not passed**. Parent identified this as overbroad sandbox gating for read-only builtin Skill content and assigned a fix. Retest this same topic after deployment; no global/agent environment settings were changed.

The Web executor routes activate/read/exec to `toolsClient.market.executeSkillTool`; `SKILL_SANDBOX_BINDING_REQUIRED` has one non-test production throw site, in `clientSkillToolEvidence.ts`, reached by `AiAgentService.resolveClientSkillToolContext` after owned persisted-message validation. Endpoint traversal is therefore supported by source-path + persisted-result evidence; no browser network/HAR capture was available.

## Negative boundary tests — not authenticated E2E

Two existing focused Vitest files passed: 8 tests, single worker, 2 GiB heap, 3.93 seconds:
- `apps/server/src/routers/tools/market.skillExecution.test.ts` (2)
- `apps/server/src/services/skillRegistry/clientSkillToolEvidence.test.ts` (6)

Coverage includes unowned topic, cross-topic tool message, wrong plugin, parent call-ID mismatch, server-owned persisted arguments, and no script execution when verification rejects. These use fixture/mock storage and are **not** real authenticated cross-user/cross-topic endpoint calls. Source inspection confirms topic/message/plugin lookups each apply ownership predicates.

## Boundaries

No browser credentials/cookies/session storage were extracted. No other topic content was read, no production service accessed, no local dev/build started, and the occupied Electron window was not touched. Database inspection used existing test pod configuration and a read-only query limited to the synthetic topic above. No raw credentials were printed or saved in this repository. No product files changed for this verification.
