# Web Skill boundary acceptance — 2026-09-09

Environment: `https://mlai-test.bielcrystal.com`; deployment reported by parent: `d0cd5d22`.

## Real authenticated UI evidence (before fix)

Created only this synthetic topic through the existing Chrome test-site session:
`/agent/agt_RIC1WM1Wad0v/tpc_lqxlov0ZlrvM`.

Requested activation of `office-documents`, then reading a bundled reference if available. Explicitly prohibited scripts, file creation, and business-content access. The topic UI displayed execution target “无设备”.

The persisted assistant message `msg_VBMtOVwy5ot1qUtLRK` declared `lobe-skills.activateSkill`, arguments `{"name":"office-documents"}`, call ID `call_00_9gL8KRaPhaULWqidqhNz3656`. Persisted tool message `msg_uQ0fHE9UAg35` had the matching parent, plugin, API, call ID, and arguments, but returned `SKILL_SANDBOX_BINDING_REQUIRED` with null state. This is a real tool failure, not merely the model describing an error. See `web-skill-boundary-before-fix.json`.

No Skill ID or reference content was returned. Normal activation/read-reference acceptance is **not passed**. Parent identified this as overbroad sandbox gating for read-only builtin Skill content and assigned a fix. Retest this same topic after deployment; no global/agent environment settings were changed.

The Web executor routes activate/read/exec to `toolsClient.market.executeSkillTool`; `SKILL_SANDBOX_BINDING_REQUIRED` has one non-test production throw site, in `clientSkillToolEvidence.ts`, reached by `AiAgentService.resolveClientSkillToolContext` after owned persisted-message validation. Endpoint traversal is therefore supported by source-path + persisted-result evidence; no browser network/HAR capture was available.

## Real authenticated UI retest after fix — passed

Refreshed the same synthetic Chrome topic after parent-confirmed deployment `0fd3a18c`, image digest `sha256:25d109e7efcce441d68430f3667d906f1d427254f580a35fe8e7c0ec6861c2cb`. The UI continued to show “无设备”; no target/global settings changed.

- Tool `msg_4VDhcHetOqev` activated `office-documents`; persisted state returned `id: builtin:office-documents`, `source: builtin`, `hasResources: true`, with 4033 UTF-8 bytes of Skill instructions.
- Tool `msg_grjYHvlfnSCT` initially read `references/excel` using compatibility alias `office-documents`; it returned `# Excel`, 932 bytes.
- A follow-up explicitly requested the returned canonical key. Tool `msg_LrZk2nhtOh8E` persisted arguments `{"id":"builtin:office-documents","path":"references/excel"}` and returned `# Excel`, 932 bytes. The content SHA256 matches the alias read (`31d0dc7421444a707a4d139d0fdb71d506421abe0dea15148f14800f964f0b15`).

All three tool records have matching assistant parent tool-call declarations and persisted plugin call IDs. See `web-skill-boundary-after-fix.json`, which retains arguments/state/call linkage and summarizes public bundled content by title, length and SHA256.

Thus the previously failing none-target builtin activation and canonical-key reference-read flow is now verified through real authenticated Web UI and durable message storage. The normal path passes. No scripts were requested/executed; none-target exec rejection was not independently exercised in authenticated E2E. Cross-topic/ownership negatives remain the focused tests below, not E2E.

Observation: the first generated read used an alias despite a request to use the returned ID. The activation resource hint still says `skillName="Office Documents"`; this was reported separately to the parent, and the explicit canonical-key follow-up passed. No product edits were made during this retest.

## Negative boundary tests — not authenticated E2E

Two existing focused Vitest files passed: 8 tests, single worker, 2 GiB heap, 3.93 seconds:

- `apps/server/src/routers/tools/market.skillExecution.test.ts` (2)
- `apps/server/src/services/skillRegistry/clientSkillToolEvidence.test.ts` (6)

Coverage includes unowned topic, cross-topic tool message, wrong plugin, parent call-ID mismatch, server-owned persisted arguments, and no script execution when verification rejects. These use fixture/mock storage and are **not** real authenticated cross-user/cross-topic endpoint calls. Source inspection confirms topic/message/plugin lookups each apply ownership predicates.

## Boundaries

No browser credentials/cookies/session storage were extracted. No other topic content was read, no production service accessed, no local dev/build started, and the occupied Electron window was not touched. Database inspection used existing test pod configuration and a read-only query limited to the synthetic topic above. No raw credentials were printed or saved in this repository. No product files changed for this verification.
