import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: resolve('e2e/model-catalog'),
  build: {
    outDir: '/tmp/masterino-model-catalog-bdd/harness',
    emptyOutDir: true,
    rollupOptions: { input: resolve('e2e/model-catalog/refresh-harness.html') },
  },
  cacheDir: resolve('node_modules/.vite-model-catalog-bdd'),
  optimizeDeps: { entries: ['refresh-harness.html'] },
  plugins: [react()],
  server: {
    port: 19329,
    host: '127.0.0.1',
    fs: { allow: [resolve('.')] },
    proxy: { '/trpc': 'http://127.0.0.1:19327' },
  },
});
