# Aihub subscription UI

## Scope

The avatar Aihub card displays subscription remainder, wallet balance, cumulative account spending and the next subscription quota reset. It opens `/settings/provider/newapi` and closes the popover. The message/topic statistics link still opens data statistics.

The New API connection card adds subscription plans, cycle usage, next reset, expiry, payment preference and an external Aihub account link. Data statistics, the model list, billing preferences and model synchronization are unchanged. No Masterino schema migration is needed.

## Data flow

`useNewApiSubscriptionSummary` → `aihub.getSubscriptionSummary` → authenticated user's existing binding → `NewApiBridgeClient` → `GET /v1/users/:id/subscriptions` → parameterized SELECTs on Aihub users, user_subscriptions and subscription_plans.

This read never provisions an account, repairs a binding or creates a token. Credentials stay on the server. Deploy the new Bridge before the Masterino server/frontend; an older Bridge returns an unavailable state rather than a fabricated unsubscribed account.

The new subscription hook shares a 30-second dedupe window and refreshes on focus. Existing account/usage hooks are unchanged. Money uses the existing account quota policy. Subscription amounts are distinct from wallet funds; an annual expiry is distinct from a monthly quota reset. A past reset timestamp is displayed as pending update, without resetting balances locally. Multiple active subscriptions retain their individual amounts/dates. A zero cycle quota follows Aihub's unlimited quota convention.

## BDD and preview

The isolated preview renders the production `NewApiBalance` and New API detail page with the real UI library. Only data hooks and the unchanged model list are replaced by test fixtures. It clearly labels synthetic data, disables account/model writes, and requires no user credentials. It does not prove an authenticated production login; router/service tests verify authenticated binding scope separately.

```sh
pnpm exec vite build --config e2e/fixtures/subscription/vite.config.ts
node e2e/fixtures/subscription/server.mjs
BASE_URL=http://localhost:3224 pnpm --dir e2e test:subscription
```

BDD covers monthly quota with annual expiry, avatar navigation and retained spending, no subscription, failed reads, exhaustion, expiry, multiple plans, narrow layout, stale reset timestamps and wallet-first preference. Its clock is fixed at 2026-10-07. No account seeding or default E2E database hooks are loaded.

On 2026-10-07 the preview web and updated Bridge were deployed as separate resources in ACK namespace `masterino-test`:

- `masterino-subscription-preview-web`, port 3224
- `masterino-subscription-preview-bridge`, port 3218

Existing workloads/ingresses were not replaced. Existing images were reused with code archives; no Docker image was built. Preview access uses a loopback port-forward:

```sh
kubectl --kubeconfig "$TEST_KUBECONFIG" -n masterino-test port-forward service/masterino-subscription-preview-web 13224:3224
```

A live authenticated GET to the isolated Bridge was verified against the existing read source: an existing subscription returned its monthly quota, amount used, annual expiry, next reset and subscription-first preference. This was a SELECT-only check; no Aihub balances/settings or subscriptions were modified.

The temporary preview deployments/services and their `masterino-subscription-preview-*` code ConfigMaps can be removed after review; no database cleanup is required.

## Real desktop integration (2026-10-07)

A full Electron renderer/main build from this worktree was launched with the isolated `masterino-desktop-test-server` profile, update installation disabled, and cloud/device gateway URLs pointing to `https://mlai-test.bielcrystal.com`. The user completed real enterprise WeChat/OIDC authorization. No fixture data hooks were used in this App run.

The actual Next.js backend build was deployed to `masterino-subscription-preview-api` in `masterino-test`, using the existing Linux runtime image plus build files and runtime dependencies. It points to the updated isolated Bridge. A separate test-host Ingress routes only lambda requests containing `aihub.getSubscriptionSummary` (including batched requests) to this service. Other requests retain the existing test service. Existing workloads were not replaced; production deployments and databases were not modified. This temporary service stores build files in an emptyDir, so recreating its pod requires uploading the build again.

### Manual BDD results on the real App

These checks used native App automation and accessibility/screenshot observations; they are separate from the nine automated fixture scenarios.

| Given / When | Then / observed result |
| --- | --- |
| Real test account completes desktop authorization | Account 10507479 opens the actual test workspace |
| User opens the avatar menu | Subscription remaining ¥695.40, wallet ¥699.89, cumulative spending ¥107.59; request count removed |
| User clicks the AIHUB avatar card | Menu closes and App opens `/settings/provider/newapi` |
| User views the New API subscription section | Current usage ¥4.60 of ¥700, next reset 2026-11-01 00:00 to ¥700; expiry 2027-08-11 10:18 remains separate |
| User views billing details | Subscription-first preference and permitted wallet fallback displayed; managed token #3961 and existing 15-model list retained |
| User clicks Manage subscription | System Chrome opens `https://aihub.bielcrystal.com/` successfully; no purchase or setting changes performed |
| Subscription backend unavailable during setup | App shows unavailable rather than falsely showing no subscription |
| Anonymous request calls the new test endpoint | HTTP 401; authenticated App reads subsequently succeed |

The model synchronization timestamp remained 2026-09-08 18:10:01 through avatar/navigation checks. No model refresh button or model switch was used, and no chat completion was sent. Screenshots are saved locally under `e2e/screenshots/subscription-real-app-avatar.png` and `subscription-real-app-details.png` (ignored generated artifacts).

The subscription API/Bridge changes require server deployment as well as a frontend/App update. The PR remains unmerged. For cleanup, also remove the isolated `masterino-subscription-preview-api` deployment/service and `masterino-subscription-preview-query` Ingress after review.
