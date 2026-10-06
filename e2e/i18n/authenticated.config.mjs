import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'authenticated.spec.mjs',
  workers: 1,
  retries: 0,
  outputDir: '/tmp/masterino-i18n-acceptance/authenticated',
  reporter: [
    ['list'],
    ['json', { outputFile: '/tmp/masterino-i18n-acceptance/authenticated.json' }],
  ],
});
