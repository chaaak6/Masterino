import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'desktop.spec.mjs',
  workers: 1,
  retries: 0,
  outputDir: '/tmp/masterino-i18n-acceptance/artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: '/tmp/masterino-i18n-acceptance/result.json' }],
    ['html', { outputFolder: '/tmp/masterino-i18n-acceptance/html', open: 'never' }],
  ],
  use: { trace: 'retain-on-failure' },
});
