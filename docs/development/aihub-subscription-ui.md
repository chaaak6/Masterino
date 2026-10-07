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
