import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@admin': path.resolve(__dirname, './src') } },
  test: { environment: 'happy-dom' },
});
