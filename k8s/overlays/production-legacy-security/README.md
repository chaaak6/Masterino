# Legacy production security overlay

This overlay is for the current `masterlion` production namespace only. It is
not referenced by another Kustomization and must not be applied automatically.

It adds exact-path rate and request-body limits for:

- `/api/auth/sign-up/email`
- `/oidc/token`
- `/webapi/trace`

The rules cover both `masterion.bielcrystal.com` and
`masterlion.bielcrystal.com` and forward to the existing `masterlion:3210`
Service. They do not deploy application code, change secrets, migrate data, or
close the findings by themselves.

Apply this overlay only as the first step of the approval-gated in-place upgrade
documented in
[`docs/operations/security-remediation-2026-07-22.md`](../../../docs/operations/security-remediation-2026-07-22.md).
