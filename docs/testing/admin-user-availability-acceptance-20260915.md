# Admin user availability acceptance (masterino-test)

Scope: the separate Admin UI, main Masterino server, and Aihub DB Bridge in the `masterino-test` namespace. Use the dedicated `MTEST10020` test account for any mutable cases. Never exercise token edits or readiness reruns on a real user. Keep the current test image digests for rollback. Production is outside this acceptance.

## User journeys

1. Sign in to the test Admin with an authorized administrator. Open **用户可用性** and confirm the list shows stored Readiness, bound Token ID, and chat model count without declaring live Aihub availability. Search `MTEST10020`, click **检查可用**, and confirm that employee number, Masterino ID, Aihub ID, readiness version/status, bound token ID, effective token status, and enabled chat model count appear. The token key must not appear in the UI, response payload, or audit log.
2. Open **更多诊断** for the same user. The existing usage diagnostics and task controls must still render. Do not pause or resume tasks merely for this test.
3. Open the bound token editor. Confirm its initial fields match the inspected token: status, expiration, unlimited quota, remaining quota in RMB, group, model restriction, and IP allowlist. Save one harmless reversible setting on the dedicated test account, reload the detail, and verify persistence. Restore the prior value.
4. Disable only the dedicated account's bound token and verify a confirmation prompt. After saving, the status must read **已禁用** even though the Aihub user remains **已启用**. The user health must be **不可用**; manual model refresh must refuse to use that token and must not create a new token. Re-enable it and verify the bound token ID is unchanged.
5. With the test token enabled, click **手动刷新模型**. Confirm a success count and updated server model timestamp. Refresh Web or restart the test Electron App, then verify the user sees the server's latest model choices. No App startup push or automatic periodic refresh is expected in this version.
6. Click **重新执行 Readiness** for the dedicated account. Confirm its warning, the active result, and that no existing-wallet top-up happens. Check the stored bound token ID after the rerun; investigate if it unexpectedly changes.
7. Sign in as `MTEST10020` through the test Web/App route, create a topic, send a short chat message, switch to another available chat model, and send another. Confirm both replies finish and the account remains usable.
8. Open **检查可用** for the dedicated user, enter **编辑绑定 Token 配置**, close the outer drawer while the editor is open, and inspect a different user. The editor must stay closed and show no previous user's draft. Return to the dedicated user; the editor must require a fresh click. Also check normal editor cancel and save followed by another user.

## Failure and isolation checks

- A missing, deleted, owner-mismatched, expired, exhausted, or disabled bound token has a distinct status; read-only detail inspection never repairs it. A disabled token remains visible in Admin even though the runtime usable-token lookup omits it.
- A user without a binding is **未初始化**, and a pending/error binding is never labeled **可用**. A token with no enabled chat model is **不可用**. An upstream outage is **待确认**, not a clean bill of health.
- Opening or paging the list must issue no per-user Aihub Bridge inspection; only **检查可用** may inspect the selected Aihub user and bound Token. Updating one user's details must not recheck the whole page.
- The editor cannot change token ID, owner, key, name, or other fields outside the allowlist. The Bridge validates exact ownership and its update transaction preserves the token key.
- `admin.listUsers`, old usage diagnostics, normal model refresh, normal readiness, Web, and Electron paths stay operational. Permission-gated Aihub management controls do not grant non-admin users edit ability.
- Query and mutation logs must contain action, target user, token ID and changed field names; they must not include token key or new secret values.

## Evidence to record

For each journey, record pass/fail, page URL, observed status or timestamp, screenshots where useful, and relevant sanitized server/Bridge log lines. If a case fails, preserve the repro sequence, repair code or test deployment, and rerun the failed case plus nearby regression cases. Restore the dedicated account's original token settings at the end.
