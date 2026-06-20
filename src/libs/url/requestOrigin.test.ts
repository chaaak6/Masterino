import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRequestOrigin, getRequestOriginFromHeaders } from './requestOrigin';

describe('request origin helpers', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses APP_URL when dynamic origins are disabled', () => {
    vi.stubEnv('APP_URL_DYNAMIC', '');
    vi.stubEnv('APP_URL', 'http://configured.example.com');

    const request = new Request('http://runtime.example.com/path', {
      headers: { host: 'runtime.example.com' },
    });

    expect(getRequestOrigin(request)).toBe('http://configured.example.com');
  });

  it('derives origin from forwarded headers when dynamic origins are enabled', () => {
    vi.stubEnv('APP_URL_DYNAMIC', '1');
    vi.stubEnv('APP_URL_ALLOWED_HOSTS', '*');

    const request = new Request('http://internal:3210/path', {
      headers: {
        'host': 'internal:3210',
        'x-forwarded-host': 'chat.example.com',
        'x-forwarded-proto': 'https',
      },
    });

    expect(getRequestOrigin(request)).toBe('https://chat.example.com');
  });

  it('falls back when the dynamic host is not allowed', () => {
    vi.stubEnv('APP_URL_DYNAMIC', '1');
    vi.stubEnv('APP_URL_ALLOWED_HOSTS', 'allowed.example.com');
    vi.stubEnv('APP_URL', 'http://configured.example.com');

    const request = new Request('http://denied.example.com/path', {
      headers: { host: 'denied.example.com' },
    });

    expect(getRequestOrigin(request)).toBe('http://configured.example.com');
  });

  it('builds a same-host Vite origin with the requested dev port', () => {
    vi.stubEnv('APP_URL_DYNAMIC', '1');
    vi.stubEnv('APP_URL_ALLOWED_HOSTS', '*');

    expect(
      getRequestOriginFromHeaders(
        new Headers({
          'host': '43.156.160.39:3210',
          'x-forwarded-proto': 'http',
        }),
        { fallbackUrl: 'http://localhost:9876', port: '9876' },
      ),
    ).toBe('http://43.156.160.39:9876');
  });
});
