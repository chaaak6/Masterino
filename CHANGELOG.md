# Changelog

All notable MasterLion changes are recorded here.

## [0.0.1] - 2026-06-20

Initial MasterLion release for the 小宗狮 internal AI workspace.

### Added

- Established MasterLion / 小宗狮 branding for the migrated AI Agent workspace.
- Added the standalone `aihub-db-bridge` service so the main application can consume Aihub read-only account, token, model, quota, and usage data without embedding direct Aihub database access.
- Added Aihub account binding and provider pages for the real acceptance account `10193226`.
- Added Aihub model synchronization with user-group ability filtering and token `model_limits` filtering.
- Added RMB quota formatting for Aihub balance, used amount, request count, prompt tokens, completion tokens, and total tokens.
- Added the same-origin S3 upload proxy at `/api/upload/s3-proxy` with signature validation for browser uploads.
- Added Browser Harness acceptance coverage for login, Aihub balance, model visibility, real AI chat, and file upload entrypoints.
- Added initial enterprise directory sync APIs and transaction wrapping for directory snapshot application.
- Added `docs/handoff/` for timestamped handoff documents.

### Changed

- Set the project version to `0.0.1`.
- Renamed user-facing repository documentation from the historical upstream identity to MasterLion.
- Updated GitHub metadata to the private repository `chaaak6/MasterLion`.
- Changed Docker release builds to use cached dependencies and `USE_CN_MIRROR=true` by default in deploy compose.
- Set `CI=true` in the Docker build environment to avoid pnpm non-TTY module purge failures.
- Changed RustFS CORS initialization to best-effort because RustFS currently returns `decoding xml: EOF` for the CORS API.
- Disabled official market task-template recommendations by default unless `MASTERLION_ENABLE_MARKET_RECOMMENDATIONS=1` is configured.

### Fixed

- Fixed the upload proxy being rewritten to signin by middleware.
- Fixed `OPTIONS /api/upload/s3-proxy` returning a runtime 500 by using a compatible empty `200` response.
- Fixed Aihub quota display so raw quota is not shown as the primary balance.
- Fixed file upload analysis flow so embedding failures do not block current-session attachment usage.
- Fixed browser-harness upload checks to follow the actual attachment menu path.

### Security

- Kept `.env`, `.env.desktop`, `.codex/`, `.next/`, `node_modules/`, temporary logs, and Python cache files out of Git.
- Preserved upload proxy signature validation; unsigned `PUT /api/upload/s3-proxy` returns `403`.
- Documented that Aihub managed tokens must stay server-side and must not be exposed to browser clients.

### Known Issues

- `QSTASH_TOKEN` is not configured in the current deployment, so Upstash Workflow/QStash scheduled workflows are disabled.
- RustFS bucket CORS configuration remains unreliable, but browser uploads are routed through the same-origin proxy.
- Full self-hosted cloud sandbox support is not included in this release; unconfigured sandbox entrypoints are hidden or downgraded.
- Several legacy package names such as `@lobehub/*` and `@lobechat/*` remain by design as internal dependency identifiers.
