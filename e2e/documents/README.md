# Local document acceptance

These tests use synthetic files and the isolated test App. They require `APP_URL=https://mlai-test.bielcrystal.com`. No production deployment or user documents are involved.

Build the bundled interpreter with `node apps/desktop/python/runtime/build.mjs`, then set:

```sh
export APP_URL=https://mlai-test.bielcrystal.com
export MASTERINO_DOCUMENT_TEST_PYTHON="$PWD/apps/desktop/resources/python-runtime/bin/python3"
NODE_OPTIONS='--import tsx' e2e/node_modules/.bin/cucumber-js --config e2e/documents/cucumber.mjs
e2e/node_modules/.bin/playwright test --config e2e/documents/playwright.config.mjs
NODE_OPTIONS='--import tsx' node e2e/documents/benchmark.mts
```

Cucumber generates a workbook expanding beyond1 GiB, a million-row workbook, known cached/missing/error measurements, CSV and a101 MiB attachment transfer. It checks classification, reuse, distinct counts, filtered row evidence, bounded groups, PDF pages/search, Office range regression, and attachment ownership.

Playwright bundles the production parser worker and uses real Electron. It checks conversation isolation, XLSX cell readback, Chinese PDF text readback, rendering, exclusive publication, no partial output when a destination already exists, and cancellation after scanning has begun. A subsequent ordinary read must finish within5 seconds.

For actual App/preload/controller acceptance, start the desktop in its test environment with remote debugging port9333. The `desktop-test` workflow supplies the test server/gateway URLs and profile; pass `--remoteDebuggingPort 9333` to electron-vite, or use a separately named isolated test profile with the same test URLs. Then run:

```sh
# Default expected profile: masterino-desktop-test-server.
# For another isolated test profile, set MASTERINO_DOCUMENT_TEST_PROFILE to its directory basename.
node e2e/documents/full-app.mjs
```

The full-App check verifies the profile before invoking tools, then exercises renderer→preload→execution boundary→worker→bundled Python/PDF, including chunked attachment IPC and attachmentId-based inspection. Results are under `.artifacts/` and are intentionally untracked. Test-cluster configuration/readiness is independently checked by `scripts/test-env/check.mts --live --context <explicit-test-context>`.

A measured macOS arm64 million-row run: existing grouped aggregate22.560 s; new cold dataset+metric analysis17.175 s (186.6 MiB peak RSS); reused grouped query+exact distinct0.095 s. These operations return different statistics, so the cold timings are indicative; dataset reuse is the main repeat-query improvement. Benchmarks are synthetic and hardware-specific.

The default installation adds DuckDB1.5.6 to the existing bundled Python and reuses PDF.js/Canvas/Electron, plus136 KiB Liberation font/license. Unicode reports use a fixed OS font path in an isolated, network-blocked report session and fail verification if the font/content is unavailable. OCR and LibreOffice remain optional external workflows. Excel formulas use stored cached values; dates remain raw serials with the date1904 flag. Windows packaging is supported by the code but was not executed on this Mac.
