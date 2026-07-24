# 2026-07-22 penetration-test remediation

This document tracks the repository and operational evidence required to close
the findings in the `masterion.bielcrystal.com` penetration-test report.

## Finding status

| Finding | Repository status                                                        | Evidence / remaining action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-01    | Implemented                                                              | Remote skills require an exact administrator-approved HTTPS origin. The initial request and every redirect use SSRF-filtering agents, private/metadata IPs are denied, response size and timeout are bounded, and network details are not returned.                                                                                                                                                                                                                                                                                  |
| F-02    | Implemented                                                              | Production disables email sign-up. The email sign-up route returns a fixed 404 before Better Auth and cannot create a session.                                                                                                                                                                                                                                                                                                                                                                                                       |
| F-03    | Implemented                                                              | Model-provider endpoints require an approved origin, local implicit endpoints are rejected, errors are sanitized, and model listing cannot borrow server environment credentials.                                                                                                                                                                                                                                                                                                                                                    |
| F-04    | Repository mitigation implemented; cloud action required                 | Application SSRF filtering and the production NetworkPolicy deny Alibaba/AWS metadata addresses. Cloud Operations must enable Alibaba metadata v2, audit attached RAM roles, and remove or minimize unnecessary permissions.                                                                                                                                                                                                                                                                                                         |
| F-05    | Implemented                                                              | Provider errors are generic. Production ingress removes middleware, rewrite, cache, prerender, invoke-path, and framework fingerprint headers.                                                                                                                                                                                                                                                                                                                                                                                       |
| F-06    | Implemented                                                              | The disabled sign-up endpoint always returns the same fixed response, independent of whether an email exists.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F-07    | Implemented                                                              | OpenAPI CORS is an explicit origin allowlist; wildcard origins are rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F-08    | Protocol-compatible mitigation implemented; secret provisioning required | Browser CORS is restricted to registered non-loopback origins, native/server responses do not expose wildcard CORS, token bodies are stream-limited, and ingress rate-limits the exact token path. Desktop/mobile/CLI are OAuth public clients, so the token endpoint must remain reachable and cannot safely embed a client secret. The server-side Market web client is registered only when `OIDC_MARKET_CLIENT_SECRET` exists and then requires `client_secret_basic`; without the secret it fails closed and is not registered. |
| F-09    | Implemented                                                              | The Better Auth admin plugin and client plugin are removed, so `/api/auth/admin/*` is not registered. Administrative product features continue through authenticated RBAC APIs.                                                                                                                                                                                                                                                                                                                                                      |
| F-10    | Implemented                                                              | Better Auth cookie cache is disabled. Existing secure and non-secure `session_data` cookies are explicitly expired on the next auth request.                                                                                                                                                                                                                                                                                                                                                                                         |
| F-11    | Partially mitigated / accepted client visibility                         | Vite and Next production browser source maps are disabled, production code-inspector injection is disabled, and full fetch URLs are not logged. Client route names and intentionally public support links remain visible because a browser SPA must receive its route and UI code.                                                                                                                                                                                                                                                   |
| F-12    | Implemented                                                              | Trace ingestion requires authentication, accepts only a strict event schema, has application and ingress body limits, and is rate-limited at ingress.                                                                                                                                                                                                                                                                                                                                                                                |
| F-13    | Implemented                                                              | Only an allowlist of public authentication error codes is rendered; untrusted values collapse to `UNKNOWN`.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F-14    | Implemented                                                              | The SPA boot route matches real route shapes, validates workspace slugs in the database, and returns an HTTP 404 for unknown roots, invalid nested paths, and invalid share paths.                                                                                                                                                                                                                                                                                                                                                   |
| F-15    | Implemented                                                              | Next's powered-by header is disabled, production ingress strips internal Next headers, browser source maps are disabled, and baseline CSP/HSTS/browser security headers are emitted.                                                                                                                                                                                                                                                                                                                                                 |

## Deployment gates

1. Obtain release approval before rebuilding the production image.
2. Build and deploy the image containing this branch.
3. Apply `k8s/overlays/production`.
4. Provision a distinct random `OIDC_MARKET_CLIENT_SECRET` (at least 32
   characters) in `masterino-secret` and in the server-side Market client that
   exchanges authorization codes. Do not expose it to SPA, desktop, mobile, or
   CLI builds.
5. In Alibaba Cloud:
   - require instance metadata v2 tokens;
   - identify the node/ECS RAM role used by the workload;
   - remove the role if unnecessary, otherwise reduce it to least privilege;
   - review CloudTrail/ActionTrail and access-key activity since the reported test.
6. Remove the penetration-test accounts through the normal administrative
   workflow.

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
