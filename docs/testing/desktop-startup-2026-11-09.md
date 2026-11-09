# Desktop startup acceptance

Scope: first-install assistant recommendations with zero preselection; desktop request-scoped agent mode, without changing Web preferences. Sidebar changes excluded.

Cases written before implementation:

| ID | Steps | Expected | Result |
|---|---|---|---|
| D1 | Fresh desktop profile: welcome → permissions (macOS) → privacy → test-server login → start | Real recommendations screen; zero selected; inbox remains the only assistant | Live pass: native welcome → permissions → data mode → test login → start; all 8 cards unchecked, Continue (0) disabled |
| D2 | Skip recommendations | Home opens; no additional assistant created | Live pass: home sidebar contained only 小宗狮 AI |
| D3 | Reopen app / returning-user login | Recommendations do not repeat after completion | Live pass: quit/relaunch opened home; returning-login branching also covered by existing LoginStep/initial-screen tests |
| D4 | Select exactly one recommendation, continue | Only selected assistant installed; reload does not duplicate | Live pass: selected only 会议纪要助手; Continue (1) installed it; completion hard reload showed exactly 小宗狮 AI + 会议纪要助手 |
| D5 | Reload during recommendations; return to login | Resume recommendations; no unauthenticated installation | Live reload resumed zero-selection recommendations. Auth guard reviewed; unauthenticated install was not separately exercised. Login/Agents restart checkpoints covered automatically |
| M1 | Existing agent stored enableAgentMode=false, toolMode=chat; open desktop | No mode picker; effective client configuration is agent; stored configuration unchanged | Live pass: seeded test inbox through its update action; DevTools showed stored false/chat and effective true/agent; home/chat mode pickers absent |
| M2 | Send a desktop request / regenerate | Request carries desktop policy; server runtime uses agent mode without persisting it | Automated pass: desktop/Web server runtime and isolated-child forwarding; live request/regenerate against the changed server not run (server not deployed) |
| M3 | Open same assistant on Web | Existing chat mode remains selectable and is preserved | Automated pass: Web projection identity, raw selector identity, unchanged server config. Live Web UI not completed: test fixture remains at its existing Web onboarding |
| R1 | Smoke test model selector, attachment menu, approval and execution controls | Available as appropriate; no automatic permission/approval escalation | Live pass: model list and context/attachment menu opened; approval menu stayed Manual. Execution device remained Local; no OS grant or approval setting was changed |
| R2 | Installation failure/retry; shared Web picker | Errors stay visible; retry is possible; existing Web finish behavior preserved | Automated pass: 9 shared-picker cases include failed install retaining selection, Skip, selected-only install, Web callbacks and desktop completion; live failure injection not run |

Risks: login/relogin and resume navigation, optional marketplace loading/failure, cross-client config leakage, server gateway vs local runtime, custom toolsets, tool approval. Test only mlai-test; do not rebuild/deploy containers or modify production. If server changes cannot be run against the test backend, distinguish automated server validation from live validation explicitly.

Validation used a clean worktree from main `be3e7172`, an isolated source-built Electron profile, and `https://mlai-test.bielcrystal.com`. DevTools IPC inspection confirmed the active remote server URL. The isolated profile gateway was set to the test endpoint before execution testing. No cluster deployment, image build, or production data modification was performed.

Automated checks passed: 117 targeted cases (mode policy, frozen execution/grants, local resolver, raw/effective selectors, plugin updates, redirects, shared picker, server runtime); 12 isolated subagent cases; 11 native login/storage/initial-screen cases; 15 desktop route-sync cases. TypeScript `pnpm exec tsgo --noEmit` passed. ESLint on changed TypeScript files passed; onboarding Hook dependency warnings were fixed. `git diff --check` passed.

After the first-run Skip/relaunch assertions, D4 reopened the real native recommendation route through DevTools navigation; no component preview or mocked installation was used. The disposable test account now contains its inbox plus the one explicitly selected recommendation.

Live inspection saw existing React/antd/Base UI development warnings. A cold Vite reload temporarily returned local-resource 502/ECONNRESET; reloading after compilation restored the app. These are separated from successful business-path assertions above.

Release dependency: ship the server support for `clientPlatform` with the desktop change. An old server accepts the optional extra field without applying the new request-scoped mode policy. This PR does not migrate or overwrite shared agent settings, custom toolsets, execution targets, workspace grants, or approval policies.
