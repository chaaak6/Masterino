// @vitest-environment node
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openApiCorsOptions } from './cors';

const preflight = (origin: string) => {
  const app = new Hono();
  app.use('*', cors(openApiCorsOptions));
  app.get('/models', (context) => context.json([]));

  return app.request('/models', {
    headers: {
      'Access-Control-Request-Headers': 'Authorization,Content-Type',
      'Access-Control-Request-Method': 'GET',
      'Origin': origin,
    },
    method: 'OPTIONS',
  });
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OpenAPI CORS policy', () => {
  it('allows the canonical app origin', async () => {
    vi.stubEnv('APP_URL', 'https://masterion.bielcrystal.com');

    const response = await preflight('https://masterion.bielcrystal.com');

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://masterion.bielcrystal.com',
    );
    expect(response.headers.get('Vary')).toContain('Origin');
  });

  it('allows an explicitly configured trusted origin', async () => {
    vi.stubEnv('APP_URL', 'https://masterion.bielcrystal.com');
    vi.stubEnv('OPENAPI_CORS_ALLOWED_ORIGINS', 'https://aihub.bielcrystal.com');

    const response = await preflight('https://aihub.bielcrystal.com');

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://aihub.bielcrystal.com',
    );
  });

  it('does not return CORS permission to an untrusted origin', async () => {
    vi.stubEnv('APP_URL', 'https://masterion.bielcrystal.com');

    const response = await preflight('https://attacker.example');

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not accept a wildcard from configuration', async () => {
    vi.stubEnv('APP_URL', 'https://masterion.bielcrystal.com');
    vi.stubEnv('OPENAPI_CORS_ALLOWED_ORIGINS', '*');

    const response = await preflight('https://attacker.example');

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
