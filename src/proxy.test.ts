// @vitest-environment node
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it, vi } from 'vitest';

import { config } from './proxy';

vi.mock('@/libs/next/proxy/define-config', () => ({
  defineConfig: () => ({ middleware: () => {} }),
}));

describe('skill upload Proxy routing', () => {
  it('excludes only the existing skill upload route, preserving API authentication routes', () => {
    const matches = (path: string) =>
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://test.example${path}` });
    expect(matches('/api/upload/s3-proxy?source=skill')).toBe(false);
    expect(matches('/api/upload/s3-proxy')).toBe(true);
    expect(matches('/api/upload/s3-proxy?source=other')).toBe(true);
    expect(matches('/api/auth/session?source=skill')).toBe(true);
    expect(matches('/trpc/lambda/agentSkills.importFromZip?source=skill')).toBe(true);
  });
});
