import { defineConfig } from '@/libs/better-auth/define-config';

export const createAuth = (options: { baseURL?: string; trustedOrigins?: string[] } = {}) =>
  defineConfig({
    ...options,
    plugins: [],
  });

export const auth = createAuth();
