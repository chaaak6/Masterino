import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.resolve(import.meta.dirname, '../../..');
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@/services/newApi', replacement: path.resolve(import.meta.dirname, 'store.ts') },
      { find: '@/store/newApi', replacement: path.resolve(import.meta.dirname, 'store.ts') },
      { find: '@/store/aiInfra', replacement: path.resolve(import.meta.dirname, 'store.ts') },
      {
        find: /..\/..\/features\/ModelList$/,
        replacement: path.resolve(import.meta.dirname, 'ModelList.tsx'),
      },
      { find: '@', replacement: path.resolve(root, 'src') },
    ],
  },
  define: { 'process.env': '{}', '__DEV__': false, '__ELECTRON__': false, '__MOBILE__': false },
  build: { outDir: '/tmp/subscription-ui-web', emptyOutDir: true },
});
