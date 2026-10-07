# Aihub subscription UI

## Scope and data flow

The avatar AIHUB card shows subscription remainder, wallet balance, cumulative spending and the next quota reset; it opens `/settings/provider/newapi` and closes the popover. The existing statistics link still opens data statistics. The New API card shows subscription usage, reset, expiry, billing preference and the Aihub link. Statistics, billing settings and model synchronization are unchanged. No schema migration is needed.

`useNewApiSubscriptionSummary` → authenticated `aihub.getSubscriptionSummary` → existing user binding → `NewApiBridgeClient` → `GET /v1/users/:id/subscriptions` → parameterized SELECTs on Aihub users, user_subscriptions and subscription_plans.

This read does not provision accounts, repair bindings, create tokens or change models. Credentials stay server-side. Deploy the updated Bridge before the Masterino server/frontend. An older/unavailable Bridge shows a read failure, not a fabricated unsubscribed state. Queries share a 30-second SWR dedupe window. Money uses the existing quota policy; monthly resets and subscription expiry remain distinct. Stale reset timestamps do not reset quota locally.

## Automated checks

`SubscriptionDetails.test.tsx` renders the actual component, using actual translations and UI components. Thirteen behavior scenarios cover annual expiry/monthly reset, no subscription, expiry, loading, failed reads, exhausted quota, stale reset, unlimited quota and multiple subscriptions/billing preference. Avatar tests verify actual subscription/wallet/spending rows; `PanelContent.test.tsx` checks the product link and its close handler. Server/router/Bridge tests cover current-user scope, anonymous rejection and SELECT-only reads.

The separate synthetic preview application and its Cucumber wrapper were removed: their duplicate navigation and mocked service checks did not prove the product's corresponding behavior. No custom preview server, store or stylesheet is needed for these component tests.

## Real desktop BDD checks (2026-10-07)

The full Electron build used independent `masterino-desktop-test-server` user data, disabled updates and test cloud/device URLs at `https://mlai-test.bielcrystal.com`. The user completed real enterprise WeChat/OIDC authorization. These native App checks used real authenticated data, without fixture hooks:

| Given / When | Then / result |
| --- | --- |
| Open avatar | Subscription ¥695.40, wallet ¥699.89, cumulative ¥107.59; request count removed |
| Click avatar AIHUB card | Menu closes; App opens provider details |
| View subscription | Used ¥4.60 of ¥700; reset 2026-11-01 to ¥700; expiry 2027-08-11 remains separate |
| View payment preference | Subscription first with permitted wallet fallback; existing token/model list retained |
| Click Manage subscription | System Chrome opens `https://aihub.bielcrystal.com/`; no purchase or setting change |
| Read fails during setup | Unavailable state, no false activation prompt |
| Anonymous new-query request | HTTP 401; authenticated App reads succeed |

No model refresh/switch or chat completion was executed. Model sync time remained 2026-09-08 18:10:01. Generated screenshots are locally stored under `e2e/screenshots/subscription-real-app-*.png`.

## Temporary test services

The actual Next backend and updated Bridge run as separate `masterino-subscription-preview-api` and `masterino-subscription-preview-bridge` workloads in ACK `masterino-test`, reusing existing images. A separate `masterino-subscription-preview-query` Ingress handles only requests containing the new query (including batches). Other requests retain the existing test service; production deployments/data were not modified. Build files are in an emptyDir and must be uploaded again if this temporary API pod is recreated.

After review, remove these temporary resources and the older synthetic `masterino-subscription-preview-web`/code ConfigMaps. No database cleanup is needed. PR #137 remains unmerged.

## Latest desktop acceptance after review corrections (2026-10-07)

Rebuilt the real Electron App from `e8f34e5c` with the same isolated test-server profile and existing real login. Updated only the temporary preview Bridge in `masterino-test`; inspected its running bundle to confirm `resetAmount` reads `amount_total` and the current-plan quota projection is absent. The preview Next API code is unchanged by the corrections.

- Avatar: subscription ¥695.40, wallet ¥699.89, cumulative ¥107.59; next reset Nov 1 to ¥700; no request count.
- Clicking the actual avatar account card closes the popover and opens the actual provider page.
- Provider: cycle used ¥4.60 / ¥700, expiry Aug 11, 2027; wallet fallback appears once beside subscription-first preference. Token #3961, 15 models and Sep 8 sync time retained.
- Manage subscription opens system Chrome at the configured Aihub homepage. No purchase or billing settings changed.
- Anonymous subscription query returns HTTP 401.
- Scaled only the temporary preview Bridge to zero and cold-started the real App: avatar shows unavailable; provider shows subscription unavailable, without claiming no subscription or prompting activation. Restored the Bridge to one ready replica and reloaded the App to verify recovery.

The real account has one active subscription with a ¥700 snapshot matching its plan. Mixed subscription restrictions and changed plan amounts remain automated regression checks, not native tests against modified real account data. Screenshots are ignored local artifacts at `e2e/screenshots/subscription-latest-app-*.png`. No production workload or subscription data was changed.
