import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = env.VITE_MASTERLION_API_BASE_URL || 'http://localhost:3010';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@admin': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3020,
      proxy: {
        '/api': {
          changeOrigin: true,
          secure: false,
          target: apiBaseUrl,
        },
        '/trpc': {
          changeOrigin: true,
          secure: false,
          target: apiBaseUrl,
        },
      },
    },
  };
});
