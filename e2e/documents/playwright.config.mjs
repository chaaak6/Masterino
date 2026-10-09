import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'electron.spec.mjs',
  workers: 1,
  timeout: 180000,
  reporter: 'list',
  outputDir: '.artifacts/playwright',
});
