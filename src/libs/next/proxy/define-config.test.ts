/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defineConfig } from './define-config';

vi.mock('@/auth', () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

const { middleware } = defineConfig();

const run = async (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => {
  const res = await middleware(new NextRequest(url, init));
  return res?.headers.get('x-middleware-rewrite');
};

describe('defineConfig locale path-traversal hardening', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('rewrites a normal locale into /spa-auth/<locale>', async () => {
    const rewrite = await run('http://localhost:3010/signin?hl=ja-JP');
    expect(new URL(rewrite!).pathname).toBe('/spa-auth/ja-JP/signin');
  });

  it('falls back to en-US for a traversal locale (plain)', async () => {
    const rewrite = await run('http://localhost:3010/signin?hl=../../api/dev/x');
    const { pathname } = new URL(rewrite!);
    expect(pathname.startsWith('/spa-auth/')).toBe(true);
    expect(pathname).toBe('/spa-auth/en-US/signin');
  });

  it('falls back to en-US for a traversal locale (percent-encoded)', async () => {
    const rewrite = await run('http://localhost:3010/signin?hl=..%2F..%2Fapi%2Fdev%2Fx');
    const { pathname } = new URL(rewrite!);
    expect(pathname.startsWith('/spa-auth/')).toBe(true);
    expect(pathname).toBe('/spa-auth/en-US/signin');
  });

  it('does not rewrite the same-origin S3 upload proxy to signin', async () => {
    const rewrite = await run('http://localhost:3010/api/upload/s3-proxy');

    expect(rewrite).toBeNull();
  });

  it('leaves skill downloads to their session/OIDC handler without a signin redirect', async () => {
    const response = await middleware(
      new NextRequest('http://localhost:3010/api/market/skills/qa-skill/download'),
    );
    expect(response?.headers.get('location')).toBeNull();
    expect(response?.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it.each(['success', 'social', 'error'])(
    'serves the public OAuth callback %s page from the auth SPA',
    async (page) => {
      const response = await middleware(
        new NextRequest(`http://localhost:3010/oauth/callback/${page}`),
      );

      expect(response?.headers.get('location')).toBeNull();
      expect(new URL(response!.headers.get('x-middleware-rewrite')!).pathname).toBe(
        `/spa-auth/en-US/oauth/callback/${page}`,
      );
    },
  );

  it('redirects protected routes to signin on the current request origin when dynamic origins are enabled', async () => {
    vi.stubEnv('APP_URL_DYNAMIC', '1');
    vi.stubEnv('APP_URL_ALLOWED_HOSTS', '*');

    const response = await middleware(
      new NextRequest('http://internal:3210/settings/provider/newapi?hl=zh-CN', {
        headers: {
          'host': 'internal:3210',
          'x-forwarded-host': 'chat.example.com',
          'x-forwarded-proto': 'https',
        },
      }),
    );

    const location = response?.headers.get('location');
    expect(location).toBeTruthy();
    const signInUrl = new URL(location!);
    expect(signInUrl.origin).toBe('https://chat.example.com');
    expect(signInUrl.pathname).toBe('/signin');
    expect(signInUrl.searchParams.get('callbackUrl')).toBe(
      'https://chat.example.com/settings/provider/newapi?hl=zh-CN',
    );
  });

  it('preserves the complete desktop OIDC request when redirecting an unauthenticated user', async () => {
    vi.stubEnv('APP_URL_DYNAMIC', '1');
    vi.stubEnv('APP_URL_ALLOWED_HOSTS', 'masterino.bielcrystal.com');

    const oidcUrl =
      'https://masterino.bielcrystal.com/oidc/auth?client_id=lobehub-desktop&response_type=code&redirect_uri=https%3A%2F%2Fmasterino.bielcrystal.com%2Foidc%2Fcallback%2Fdesktop&code_challenge=challenge&code_challenge_method=S256&prompt=consent&resource=urn%3Alobehub%3Achat&scope=profile%20email%20offline_access&state=desktop-state';

    const response = await middleware(
      new NextRequest(oidcUrl, {
        headers: {
          'host': 'masterino.bielcrystal.com',
          'x-forwarded-host': 'masterino.bielcrystal.com',
          'x-forwarded-proto': 'https',
        },
      }),
    );
    const location = response?.headers.get('location');

    expect(location).toBeTruthy();
    const signInUrl = new URL(location!);
    expect(signInUrl.pathname).toBe('/signin');
    expect(signInUrl.searchParams.get('callbackUrl')).toBe(oidcUrl);
  });
});
