# Group execution and conversation recovery acceptance

Baseline: `a452b182`. Use the isolated Electron `test-server` profile and the
`masterino-test` namespace. Use a new synthetic group and fixed markers.
“Local” refers to orchestration and tool execution on this Electron client;
message persistence and the configured model still use the test backend.

| Scenario                                                                         | Expected result                                                                                                                                         | Verification                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Create a blank group, add a member, start a topic                                | Desktop keeps the group supervisor on the client when the target is local or unspecified                                                                | Electron + test database                  |
| Delegate one fixed-marker task with an already enabled automatic approval policy | No approval form for the delegation; Network shows `createClientGroupAgentTaskThread`, not `execSubAgentTask`; the member thread and task card complete | Electron / DevTools + executor regression |
| Approve a group tool                                                             | Approval uses the original group and topic history, even if another group is visible; the tool result can resume the supervisor                         | Store regression                          |
| A local member requests permission for its own tool | The card shows that approval is needed and the supervisor waits. Approving resumes the same member thread; it completes only once the member finishes | Executor regression; live manual flow pending |
| Delegate from an asynchronous callback after changing topics                     | The original group and topic are used; desktop tasks stay local                                                                                         | Store regression                          |
| Schedule several desktop jobs                                                    | Each runs locally; task cards retain the terminal status and thread ID                                                                                  | Executor regression                       |
| Add and remove members                                                           | Adding is limited to the current resource scope; leaving unlinks only the named membership and preserves history                                        | Isolated database integration             |
| Start a worker in a group                                                        | The group, topic, parent and active member must match before local or server launch                                                                     | tRPC integration on isolated database     |
| Lose the ordinary agent event subscription                                       | Reconnect from the last event ID. If recovery is exhausted, release the running UI while keeping the server operation link for reopening the topic      | Stream and gateway regressions            |

For a manual follow-up, switch only a disposable test profile to manual; call
the calculator or dispatch a marker task, approve, then verify the final
answer in the same thread without refreshing. For disconnect recovery use
DevTools network loss only in the isolated test client, then restore
connectivity and reopen the same topic. Avoid claiming a server operation was
cancelled when only the client subscription was lost.

## Recorded acceptance

- The isolated Electron client created a synthetic group and a worker. Network
  showed `aiAgent.createClientGroupAgentTaskThread` followed by
  `aiAgent.updateClientTaskThreadStatus`. The first run persisted the result and
  completed the thread, but left the task card at “Starting”. The regression
  test reproduced the missing card update. After rebuilding, a new run showed
  the member result `QA-1116-ACK` and the supervisor's summary without a reload.
  The test database recorded completed member threads and no server agent
  operations for the local group topic.
- An ordinary agent conversation returned a reply and released the composer.
  The existing test-agent input template produced `CUTOVER_OK`; its settings
  were left as found. Transport interruption and replay were exercised by
  deterministic SSE, WebSocket and store tests, not a live outage.
- Browser Use reached the test site's sign-in page. Authenticated flows used
  the isolated Electron profile. Its existing approval policy was left as
  found; manual approval was verified through the store tests.
- Test cluster pod logs had no correlated business lines in the checked time
  window. DevTools requests and the synthetic topic's database state provided
  the runtime evidence. The branch's server build was not deployed to the
  shared test cluster; authorization ran against an isolated database.

A member run awaiting permission is held by the current Electron renderer.
Closing the app does not resume the supervisor and worker together after restart.
