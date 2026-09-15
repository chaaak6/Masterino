# User availability acceptance — masterino-test

This report uses the dedicated `MTEST10020` account and the independent real-click test case list in `admin-user-availability-acceptance-20260915.md`. No production resources or other users were changed. The local test Electron App was launched with the `test-server` profile; `/Applications/Masterino.app` was not used.

## Deployed components

| Component | Test image digest | Rollout |
| --- | --- | --- |
| Main server and memory worker, initial test candidate | `sha256:ad24943f883a6b3375b404b86292a6e2c6c56f61e0bf143dd2e46df6277bcf0c` | 1/1 Ready, superseded by list-health fix |
| Main server and memory worker, list-health fix | `sha256:71a50ba9f14c4e49a953231ddbb38a6272905d18b1c17bc77446b4fe95f8e999` | 1/1 Ready; App regression passed; Admin list retest pending |
| Aihub DB Bridge | `sha256:6cb96da941571928f54076337b3224b36f0df4c521f718c0405649dd4a9601e3` | 1/1 Ready |
| Admin, Token save fix | `sha256:a7e508487f111bc5ba04802702438a0a35d76f13a3f3cf1f96a237e5b66817b7` | 1/1 Ready, superseded by feedback build |
| Admin, persistent action feedback | `sha256:cdb0ee028d3bec0c8cf557ddd297f0cac113e9a2dbdc3d0cf28d3e2c59a5376b` | 1/1 Ready, superseded by wording build |
| Admin, final model-count wording | `sha256:88b16c5ffe5749a005822be779c590c6a53fb77b0bab932a69ab26c3b8324b50` | 1/1 Ready; real-click retest passed |

The server list-health image and final real-click retests will be recorded after deployment.

## Real-click results

| Case | Result | Evidence |
| --- | --- | --- |
| Admin user search/detail | Pass | `MTEST10020` maps to Aihub user 2699 and bound Token 4956; active/v2, enabled user, active token, nine chat models. No token key appeared in UI. |
| Existing usage diagnostics | Pass | Usage, limits, task and operation sections rendered; no task controls were changed. |
| Bound Token edit | Pass after fix | Original attempt failed in the browser because a hidden optional form field was `undefined` and `.trim()` ran before mutation. After the fix, group changed from empty to `default`, was confirmed by read-only Aihub DB query, and was restored to empty. |
| Disable, refuse refresh, restore | Pass after feedback fix | Confirmation appeared. While disabled, detail showed the Aihub user enabled but overall unavailable and Token disabled. The model-sync audit recorded a failed call with `Bound Aihub token is unavailable`; no model timestamp change. The same Token 4956 was re-enabled by real UI in the first pass. A later feedback-only pass was interrupted by foreground-window changes; its Token restore used a guarded internal Bridge PATCH and DB check, and is recorded as a technical recovery. After the window stabilized, real Computer Use captured the persistent unavailable-token error Alert and the recovered usable state. |
| Independent admin model refresh | Pass after wording fix | The detail timestamp moved to 2026-09-15 13:16:34 CST. Normal test-App reload showed nine chat choices. Final real-click refresh at 13:50:21 CST showed a closeable Alert stating 11 models of all types were synced and the detail separately counted nine usable chat models. Read-only DB confirmed nine chat and two embedding. |
| Readiness rerun | Pass | Confirmation described identity/binding recheck without existing-wallet top-up. The binding remained active/v2 and Token 4956, with last sync 2026-09-15 13:17:08 CST. Audit recorded success. |
| Test Electron chat/model switch | Pass | Topic `tpc_BLgaYu7fgdbZ`: first assistant reply used `deepseek-v4-flash-vision-exp`, second used `deepseek-v4-flash`, confirmed by read-only test-DB message snapshots. After normal App reload, history persisted and a third reply completed. Original topic model preference was restored. After the final server rollout, the same worktree test App was reloaded and a fourth reply completed at 14:02:13 CST. |
| Test Web chat/model switch | Blocked by test credential | Isolated normal email login reached Better Auth but returned `Invalid password`; no Web conversation was submitted, no session cookie was copied or injected. |

The dedicated Token is back to its original state: ID 4956, enabled, never expires, unlimited quota on, group empty, model restriction off, and no IP allowlist. Aihub account and Masterino binding remain active. Browser screenshots and step-level observations are in the independent tester's local acceptance record; this report records the relevant sanitized database and audit checks. The Browser test was paused while the user changed the foreground Chrome window; no unrelated page was counted as test evidence.

## Verification

The focused Bridge HTTP/repository, user-availability service, New API model-sync, and existing Admin router tests passed. Bridge type-check and Admin Vite build passed. Targeted ESLint and `git diff --check` passed. The broad type-check reports pre-existing unrelated errors in the current `main` files; the changed areas did not add new errors. All three new ACR images were built for `linux/amd64` and rolled out only in `masterino-test`.
