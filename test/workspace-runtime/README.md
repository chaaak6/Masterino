# Workspace Runtime independent acceptance harness

This harness is derived only from approved AC-W01..W10, AC-P01..P08, AC-M01..M06,
AC-C01..C08, AC-X01..X02 and the accepted C0 contracts at
`348d5cb6bfd2e57f43a7ff021b6eadfcc0d254f6`.

- `acceptanceMatrix.ts` is the exhaustive 34-row mapping and frozen argv source.
- `acceptanceAssertions.ts` is the reusable behavioral suite.
- `referenceAdapter.ts` proves that every assertion and fixture contract is executable.
- `productionAdapter.ts` binds the non-Electron rows to production policy, resolver, boundary, and
  navigation seams; `acceptedRefAdapter.ts` composes those with AC-W01..W03.
- `e2e/electron/workspace-runtime.spec.ts` is the focused production-renderer/main-process suite.
  Its runtime rows use an isolated PGlite database and temporary filesystem, and count external
  provider/device calls.

The security-sensitive oracle details are intentional: AC-C08 enables `retry_compression` and
`switch_compression_model` only for `SUMMARY_FAILED`; AC-P06 denies sensitive reads under auto-run
with zero provider calls while ordinary external writes are prepared; and AC-P07 keeps the model's
requested cwd as fixture input while exposing only `MODEL_CWD_OVERRIDDEN` in audit warnings.

## Integration status

All acceptance rows are bound. The Electron controller launches the production renderer and preload
IPC bridge, isolates database/filesystem state per session, cleans it on close, and collects this
spec through the repository Playwright config.

## Frozen verification argv

```text
bunx vitest run --silent=passed-only test/workspace-runtime
pnpm exec playwright test --config=e2e/electron/playwright.config.mjs --list e2e/electron/workspace-runtime.spec.ts
bun run type-check
git diff --check
```
