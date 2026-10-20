import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

export default defineConfig({
  webServer: [
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      command:
        'env DATABASE_DRIVER=node DATABASE_URL=postgresql://postgres@127.0.0.1:15436/catalog_bdd KEY_VAULTS_SECRET=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= MARKET_BASE_URL=http://127.0.0.1:19327 AIHUB_BRIDGE_URL=http://127.0.0.1:19327 AIHUB_BRIDGE_TOKEN=bdd-fixture-only AIHUB_PROXY_URL=http://127.0.0.1:19327 bunx tsx e2e/model-catalog/fixture-server.mts',
      url: 'http://127.0.0.1:19327/bdd/state',
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      command:
        'env VITE_MASTERLION_API_BASE_URL=http://127.0.0.1:19327 pnpm --filter @masterlion/admin build && env VITE_MASTERLION_API_BASE_URL=http://127.0.0.1:19327 pnpm --filter @masterlion/admin exec vite preview --host 127.0.0.1 --port 19328',
      url: 'http://127.0.0.1:19328',
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      command:
        'bunx vite build --config e2e/model-catalog/vite.config.mts && bunx vite preview --config e2e/model-catalog/vite.config.mts --host 127.0.0.1 --port 19329',
      url: 'http://127.0.0.1:19329/refresh-harness.html',
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
  testDir: '.',
  testMatch: '*.spec.mts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    actionTimeout: 8000,
    viewport: { width: 1365, height: 1000 },
    trace: 'retain-on-failure',
  },
  outputDir: '/tmp/masterino-model-catalog-bdd/results',
});
