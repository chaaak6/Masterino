# 2026-07-22 penetration-test remediation

This document tracks the repository and operational evidence required to close
the findings in the `masterion.bielcrystal.com` penetration-test report.

## Finding status

| Finding | Repository status                                                            | Evidence / remaining action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-01    | Implemented                                                                  | Remote skills require an exact administrator-approved HTTPS origin. The initial request and every redirect use SSRF-filtering agents, private/metadata IPs are denied, response size and timeout are bounded, and network details are not returned.                                                                                                                                                                                                                                                                                  |
| F-02    | Implemented                                                                  | Production disables email sign-up. The email sign-up route returns a fixed 404 before Better Auth and cannot create a session.                                                                                                                                                                                                                                                                                                                                                                                                       |
| F-03    | Implemented                                                                  | Model-provider endpoints require an approved origin, local implicit endpoints are rejected, errors are sanitized, and model listing cannot borrow server environment credentials.                                                                                                                                                                                                                                                                                                                                                    |
| F-04    | Application and credential-chain mitigation implemented; node action remains | Application SSRF filtering always denies Alibaba/AWS metadata addresses. The application container disables Alibaba Cloud and AWS SDK metadata credential providers and forbids Alibaba Cloud IMDSv1 fallback. NetworkPolicy excludes the metadata addresses as defense in depth, but it is not treated as an authoritative control because ACK/Terway can exempt node traffic. The shared ECS nodes still require a coordinated IMDSv2 migration.                                                                                   |
| F-05    | Implemented                                                                  | Provider errors are generic. Production ingress removes middleware, rewrite, cache, prerender, invoke-path, and framework fingerprint headers.                                                                                                                                                                                                                                                                                                                                                                                       |
| F-06    | Implemented                                                                  | The disabled sign-up endpoint always returns the same fixed response, independent of whether an email exists.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F-07    | Implemented                                                                  | OpenAPI CORS is an explicit origin allowlist; wildcard origins are rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F-08    | Protocol-compatible mitigation implemented                                   | Browser CORS is restricted to registered non-loopback origins, native/server responses do not expose wildcard CORS, token bodies are stream-limited, and ingress rate-limits the exact token path. Desktop/mobile/CLI are OAuth public clients, so the token endpoint must remain reachable and cannot safely embed a client secret. The server-side Market web client is registered only when `OIDC_MARKET_CLIENT_SECRET` exists and then requires `client_secret_basic`; without the secret it fails closed and is not registered. |
| F-09    | Implemented                                                                  | The Better Auth admin plugin and client plugin are removed, so `/api/auth/admin/*` is not registered. Administrative product features continue through authenticated RBAC APIs.                                                                                                                                                                                                                                                                                                                                                      |
| F-10    | Implemented                                                                  | Better Auth cookie cache is disabled. Existing secure and non-secure `session_data` cookies are explicitly expired on the next auth request.                                                                                                                                                                                                                                                                                                                                                                                         |
| F-11    | Source-map exposure fixed; public product metadata accepted                  | Vite and Next production browser source maps are disabled, production code-inspector injection is disabled, and full fetch URLs are not logged. Client route names remain visible because a browser SPA must receive its route and UI code. The public GitHub repository URL and official support email are intentional public product metadata, not secrets; obscuring them would not restrict access to the public repository.                                                                                                     |
| F-12    | Implemented                                                                  | Trace ingestion requires authentication, accepts only a strict event schema, has application and ingress body limits, and is rate-limited at ingress.                                                                                                                                                                                                                                                                                                                                                                                |
| F-13    | Implemented                                                                  | Only an allowlist of public authentication error codes is rendered; untrusted values collapse to `UNKNOWN`.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F-14    | Implemented                                                                  | The SPA boot route matches real route shapes, validates workspace slugs in the database, and returns an HTTP 404 for unknown roots, invalid nested paths, and invalid share paths.                                                                                                                                                                                                                                                                                                                                                   |
| F-15    | Implemented                                                                  | Next's powered-by header is disabled, production ingress strips internal Next headers, browser source maps are disabled, and baseline CSP/HSTS/browser security headers are emitted.                                                                                                                                                                                                                                                                                                                                                 |

## Deployment gates

1. Obtain release approval before rebuilding the production image.
2. Build and deploy the image containing this branch.
3. Apply `k8s/overlays/production`.
4. If the server-side Market integration is enabled, provision a distinct random
   `OIDC_MARKET_CLIENT_SECRET` (at least 32 characters) in `masterino-secret`
   and in the Market client that exchanges authorization codes. Do not expose
   it to SPA, desktop, mobile, or CLI builds. If the integration is disabled,
   keep the variable absent so the confidential Market client remains
   unregistered.
5. In Alibaba Cloud, migrate the worker nodes to IMDSv2 only after completing
   the compatibility and workload-impact checks in the environment audit below.
   Prefer a new security-hardened node pool for Masterion; otherwise coordinate
   a maintenance window before changing shared existing nodes.
6. Remove the penetration-test accounts through the normal administrative
   workflow.

## Test environment audit (2026-07-24)

The following checks were performed against `mlai-test.bielcrystal.com` and the
ACK cluster hosting `masterino-test`. No metadata credential values or secret
values were read.

### Alibaba Cloud metadata and RAM role

- All three ACK ECS nodes currently have metadata enabled with
  `HttpTokens=optional`, so tokenless IMDSv1 is still accepted at the node
  boundary.
- The cluster is Kubernetes `v1.36.1-aliyun.1`. Installed ACK component versions
  meet the published IMDSv2 prerequisites, including
  `cloud-controller-manager v2.14.0`, `terway v1.17.5`,
  `csi-plugin v1.36.2`, `storage-operator v1.35.3`,
  `loongcollector 3.3.4`, `alicloud-monitor-controller v1.8.10`,
  `ack-node-problem-detector 1.2.37`, and `ack-cost-exporter 1.0.23`.
- The nodes use
  `aliyun_4_x64_20G_container_optimized_alibase_20260430.vhd`; a read-only
  Cloud Assistant command confirmed `cloud-init 23.2.2-8.alnx4` on all three
  nodes.
- All three nodes have the same worker role,
  `KubernetesWorkerRole-de717cae-f771-44e3-8c6b-b11cff52e529`. The role has no
  attached RAM policies. An ActionTrail lookup for this role from
  `2026-07-22T00:00:00Z` through `2026-07-24T13:59:59Z` returned no events.
- A status-only probe from the application pod confirmed that Alibaba metadata
  was reachable without a token before node hardening. No role name, credential
  body, AccessKey, or security token was retrieved.
- The nodes are shared with the `masterlion`, `masterlion-test`,
  `biel-life-camp`, observability, and system workloads. Changing the existing
  ECS metadata mode is therefore a cluster-wide operation, not a
  `masterino-test`-only deployment change.

Required node-level closeout:

1. Confirm the shared workloads do not use IMDSv1, using the CloudMonitor ECS
   metadata metric or the supported IMDS packet analyzer.
2. Create a security-hardened node pool and move Masterion to it, or approve a
   coordinated one-node-at-a-time change of the existing shared nodes.
3. Set `HttpEndpoint=enabled` and `HttpTokens=required`.
4. Verify application health and confirm that an unauthenticated metadata GET
   returns `403`; retain a documented rollback to `HttpTokens=optional`.

### HTTP and build regression evidence

- Email sign-up returns a fixed `404`; the unauthenticated skill-import and
  model-provider probes return `401`.
- Attacker-origin OpenAPI preflight receives no
  `Access-Control-Allow-Origin`.
- An unauthenticated `client_credentials` request to `/oidc/token` returns
  `unsupported_grant_type` and no access token. The test secret intentionally
  omits `OIDC_MARKET_CLIENT_SECRET`, so the confidential Market client is not
  registered.
- `/api/auth/admin/list-users` returns `404`, unauthenticated
  `/webapi/trace` returns `401`, unknown `/wp-admin` returns `404`, and an
  untrusted auth-error marker is not reflected.
- Legacy secure and non-secure `session_data` cookies are both expired on the
  next auth request.
- The deployed page emits CSP and HSTS, exposes no Next.js internal routing
  headers, contains no `sourceMappingURL` reference, and publishes no source-map
  file for the discovered JavaScript assets.

## Post-deployment verification

Run the checks from a network that reaches the production ingress:

```bash
# Registration is closed and does not enumerate users.
curl -i -X POST https://masterion.bielcrystal.com/api/auth/sign-up/email \
  -H 'content-type: application/json' \
  --data '{"email":"unknown@example.invalid","password":"not-a-real-password","name":"Test"}'

# Unknown and malformed SPA paths return HTTP 404.
curl -I https://masterion.bielcrystal.com/wp-admin
curl -I https://masterion.bielcrystal.com/share/not-a-real-share-route
curl -I https://masterion.bielcrystal.com/agent/test/topic/extra

# Unauthenticated trace ingestion is rejected.
curl -i -X POST https://masterion.bielcrystal.com/webapi/trace \
  -H 'content-type: application/json' \
  --data '{"eventType":"copyMessage","traceId":"test","content":"test"}'

# An attacker origin does not receive OpenAPI or OIDC CORS access.
curl -i -X OPTIONS https://masterion.bielcrystal.com/api/v1/chat/completions \
  -H 'origin: https://attacker.invalid' \
  -H 'access-control-request-method: POST'
curl -i -X POST https://masterion.bielcrystal.com/oidc/token \
  -H 'origin: https://attacker.invalid'

# Framework/internal routing headers must be absent.
curl -sSI https://masterion.bielcrystal.com/ \
  | grep -Ei 'x-powered-by|x-middleware|x-nextjs|x-invoke'
```

After a production build, verify that no browser source-map references or map
files are published:

```bash
rg -n 'sourceMappingURL' public/_spa .next/static
rg --files public/_spa .next/static | rg '\.map$'
```
