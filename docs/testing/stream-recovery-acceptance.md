# Stream recovery and loading-state acceptance

## Contract

The model-call transport, agent run, message loading indicator and composer Stop button must agree
about whether work is active. Retry only the current model call. Never restart an agent run or
repeat a local tool to recover a missing result. Preserve failed/cancelled states during late
connection cleanup.

- Temporary connection failures, 502/503/504, and an unexpected newapi EOF: at most three attempts
  including the initial request, with interruptible 1s/3s backoff and jitter.
- 429: retry only with a bounded Retry-After; quota, authentication, permission, malformed data,
  oversized input and provider business errors require user action.
- Offline: wait up to 30s for connectivity without issuing a request loop. Stopping cancels the wait.
- Partial text is visible during recovery but is replaced, never concatenated with the retry.
  Discard old reasoning/tool state before the next attempt. No incomplete tool call is executed.
- A client that owns recovery sends X-Masterino-Client-Recovery so the newapi route does not
  multiply the budget with its own retries. Existing clients keep the existing server policy.
- Require a terminal stop for the known OpenAI-compatible newapi protocol. Preserve legacy
  provider completion contracts and complete non-streaming responses. Output-limit/filter stops
  are interrupted output, not successful generation. A network loss after confirmed stop does
  not replay the completed generation.
- Server agent subscriptions reconnect to the same operation/cursor. Transport failures do not
  mean the server task ended. Exhaustion explicitly says that the server task may still run.
- Stream completion waits for buffered gateway events and the final message snapshot. Failed
  subscriptions/runs must not be reclassified as successful by later session cleanup.

## Seams and scenarios

1. Real fetchSSE + ReadableStream: normal stop, premature EOF, connection reset, partial-output
   replacement, three-attempt exhaustion, HTTP 400/401/403/413, 502/503/504, rate/quota limits,
   malformed chunks, offline expiry, stop during backoff, partial tool calls, persistence ordering,
   output-limit/filter stop, and transport loss after confirmed completion.
2. Real client call_llm executor / StreamingHandler / production operation actions: errors halt
   the run, partial tools are not executable, reasoning/tool loading is released, and failed runs
   remain failed after late cleanup. Gateway completion drains queued message processing.
3. Native Electron BDD: production fetchSSE, operation actions/selectors, useOperationState and
   editor SendButton. Scenarios exercise success, slow streaming, premature EOF recovery, TCP reset,
   exhaustion, 503 recovery, Retry-After, auth/input/provider/parse rejection, non-streaming output,
   user Stop, and offline recovery. Assert both message loading and composer generating flags.

The Electron acceptance lane uses a deliberately small test surface around production modules;
it is not a replacement for a packaged-client release smoke test. Network, console diagnostics
and screenshots are attached to Cucumber's JSON report. Deterministic transport unit tests and
live cluster faults complement one another.

## Isolation

Use the named fixture pod/configmap `masterino-stream-recovery-bdd` only in `masterino-test`.
Verify its namespace's `masterino.io/ack-cluster-id` annotation before creating it. Reuse the test
app's existing image to run `e2e/stream-recovery/faultServer.cjs`; do not rebuild/publish images or
replace the shared test deployment. No production application, database, secret or ingress is
modified. Recreate the task-owned port-forward whenever the fixture pod is replaced.

For a local-only run, run the same fault server with Node on port 14321. For ACK acceptance,
mount it into the isolated pod and port-forward 14321. The fixture contains synthetic output only.
Remove its pod/configmap and stop the tunnel after acceptance.

## Commands

```bash
# Unit/integration regression suites (run only these files, not the global suite)
cd packages/fetch-sse
pnpm exec vitest run --silent=passed-only src/__tests__/recovery.test.ts src/__tests__/fetchSSE.test.ts
cd ../..
pnpm exec vitest run --silent=passed-only \
  src/store/chat/agents/__tests__/createAgentExecutors/call-llm.test.ts \
  src/store/chat/agents/StreamingHandler.test.ts \
  src/services/agentRuntime/SameOriginAgentStreamClient.test.ts \
  src/store/chat/slices/aiChat/actions/__tests__/gateway.test.ts \
  src/store/chat/slices/aiChat/actions/__tests__/gatewayEventHandler.test.ts \
  src/store/chat/slices/operation/__tests__/actions.test.ts \
  src/services/chat/chat.test.ts \
  'src/app/(backend)/webapi/chat/[provider]/route.test.ts'

# Build the actual production module graph outside Cucumber's CommonJS TS hook
node --input-type=module -e \
  'import {buildProductionLifecycle} from "./e2e/electron/support/buildProductionLifecycle.mjs"; await buildProductionLifecycle();'
cd e2e
STREAM_BDD_PREBUILT=1 pnpm exec cucumber-js --config stream-recovery.config.cjs
```

## Evidence for this branch

Final validation after review repairs:

- 340 selected unit/integration tests passed (45 transport, 141 executor/handler/subscription/
  operation, 98 gateway processing, 56 chat service/backend ownership).
- Native Electron + local fault server: 15 scenarios / 68 steps passed.
- Native Electron + ACK test fixture: 15 scenarios / 68 steps passed again. Network and console
  attachments contain only the expected injected HTTP errors, reset, offline and abort failures;
  no additional JavaScript errors were recorded on the passing run.
- Earlier repeated runs exposed extra `net::ERR_FAILED` requests with Playwright request routing
  enabled. Blocking production domains through Electron's session filter instead removed these
  extra failures in both local and cluster acceptance. Request-count assertions were retained.
- Targeted production-file ESLint and diff whitespace checks passed. The production module graph
  built successfully; pre-existing dynamic-import warnings remain.
- Two independent code reviews led to cancellation finalization and final-snapshot failure
  propagation regressions being repaired and covered.

The actual development App was pointed explicitly at the test server with app updates disabled.
Its expired login prevented an authenticated full-conversation smoke test. The native BDD lane
above exercises production modules through an isolated acceptance surface, not a released App
binary or a logged-in shared test deployment. No deployment or release is part of this PR.

The global type check already reports unrelated failures on the pinned main baseline under the
same dependency setup. Compare normalized diagnostics rather than presenting a failing baseline
as a passing full type check.

Normalized final type diagnostics add zero errors to the pinned main baseline.
