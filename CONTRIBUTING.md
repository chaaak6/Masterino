# MasterLion Contributing Guide

MasterLion is a private, company-internal AI workspace. Contributions should focus on the 小宗狮 product direction: Aihub integration, enterprise governance, local deployment stability, file analysis, model controls, and internal user experience.

## Repository

```bash
git clone https://github.com/biel-cc/MasterLion.git
cd MasterLion
```

The historical upstream codebase still contains legacy package names such as `@lobehub/*` and `@lobechat/*`. Treat those as implementation identifiers. Do not rename package names, provider ids, database enums, or import paths unless the migration impact is reviewed explicitly.

## Development Flow

1. Start from the current target branch.
2. Check the workspace before editing:

   ```bash
   git status -sb
   git diff --stat
   ```

3. Keep changes focused and avoid unrelated refactors.
4. Do not commit secrets, `.env`, `.env.desktop`, `.codex/`, `.next/`, `node_modules/`, logs, or local runtime caches.
5. Run targeted tests for the touched area before handoff.

## Local Setup

```bash
corepack enable
pnpm install
pnpm run dev
```

Docker remains the preferred deployment mode. During active development, avoid rebuilding images for every source change; rebuild only when preparing a release.

## Validation

Use focused commands:

```bash
corepack pnpm run type-check
node .\node_modules\vitest\vitest.mjs run <test-file>
```

For release validation, also run the Browser Harness acceptance flow when Aihub chat, balance, model selection, or file upload behavior changes.

## Security and Boundaries

- The main MasterLion app must not connect directly to the Aihub database.
- Use `aihub-db-bridge` for controlled read-only Aihub data access.
- Never expose managed Aihub token values to browser clients.
- Aihub model lists must be filtered by user group and token model limits.
- Browser file uploads should go through `/api/upload/s3-proxy`.

## Pull Requests

Use concise titles and include:

- what changed
- why it changed
- tests run
- release or deployment impact
