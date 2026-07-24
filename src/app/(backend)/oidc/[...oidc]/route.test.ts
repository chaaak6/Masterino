/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNodeRequest: vi.fn(),
  createNodeResponse: vi.fn(),
  middleware: vi.fn(),
  providerCallback: vi.fn(),
  responseHeaders: {} as Record<string, string>,
}));

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    ENABLE_OIDC: true,
  },
}));

vi.mock('@/libs/oidc-provider/http-adapter', () => ({
  createNodeRequest: mocks.createNodeRequest,
  createNodeResponse: mocks.createNodeResponse,
}));

vi.mock('@/libs/oidc-provider/config', () => ({
  defaultClients: [
    {
      client_id: 'desktop',
      redirect_uris: [
        'https://masterion.example/oidc/callback/desktop',
        'http://localhost:3210/oidc/callback/desktop',
      ],
    },
    {
      client_id: 'market',
      redirect_uris: ['https://market.example/oidc/callback'],
    },
  ],
}));

vi.mock('@/server/services/oidc/oidcProvider', () => ({
  getOIDCProvider: vi.fn(async () => ({
    callback: mocks.providerCallback,
  })),
}));

describe('OIDC route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    for (const key of Object.keys(mocks.responseHeaders)) delete mocks.responseHeaders[key];

    mocks.providerCallback.mockReturnValue(mocks.middleware);
    mocks.createNodeResponse.mockReturnValue({
      nodeResponse: {},
      responseBody: '',
      responseHeaders: mocks.responseHeaders,
      responseStatus: 200,
    });
  });

  it('returns a 500 response when creating the Node request fails', async () => {
    mocks.createNodeRequest.mockRejectedValueOnce(new Error('body stream aborted'));

    const { POST } = await import('./route');
    const request = new Request('https://example.com/oidc/token', {
      body: 'grant_type=refresh_token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    }) as unknown as NextRequest;

    const response = await Promise.race([
      POST(request),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OIDC route timed out')), 50),
      ),
    ]);

    expect(response.status).toBe(500);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      error: 'server_error',
      error_description: 'The authorization server failed the request',
    });
    expect(JSON.stringify(responseBody)).not.toContain('body stream aborted');
    expect(mocks.middleware).not.toHaveBeenCalled();
  });

  it('rejects an unregistered browser origin before invoking the provider', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      new Request('https://example.com/oidc/token', {
        headers: { origin: 'https://attacker.example' },
        method: 'POST',
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('vary')).toBe('Origin');
    expect(mocks.providerCallback).not.toHaveBeenCalled();
  });

  it('does not allow legacy loopback redirect origins to use browser CORS in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { POST } = await import('./route');
    const response = await POST(
      new Request('https://example.com/oidc/token', {
        headers: { origin: 'http://localhost:3210' },
        method: 'POST',
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(mocks.providerCallback).not.toHaveBeenCalled();
  });

  it('removes oidc-provider wildcard CORS from native and server token responses', async () => {
    mocks.responseHeaders['Access-Control-Allow-Origin'] = '*';
    mocks.createNodeRequest.mockResolvedValue({});
    mocks.middleware.mockImplementation((_req, response) => response.end?.());
    mocks.createNodeResponse.mockImplementationOnce((resolve: () => void) => ({
      nodeResponse: { end: resolve },
      responseBody: '{}',
      responseHeaders: mocks.responseHeaders,
      responseStatus: 400,
    }));

    const { POST } = await import('./route');
    const response = await POST(
      new Request('https://example.com/oidc/token', {
        body: 'grant_type=authorization_code',
        method: 'POST',
      }) as unknown as NextRequest,
    );
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects oversized token requests before reading the body', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      new Request('https://example.com/oidc/token', {
        headers: { 'content-length': String(16 * 1024 + 1) },
        method: 'POST',
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(413);
    expect(mocks.providerCallback).not.toHaveBeenCalled();
  });

  it('returns 413 when a chunked token body exceeds the adapter limit', async () => {
    const oversizedError = new Error('OIDC request body is too large');
    oversizedError.name = 'OIDCRequestBodyTooLargeError';
    mocks.createNodeRequest.mockRejectedValueOnce(oversizedError);

    const { POST } = await import('./route');
    const response = await POST(
      new Request('https://example.com/oidc/token', {
        body: 'grant_type=refresh_token',
        method: 'POST',
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: 'invalid_request',
      error_description: 'Request body is too large',
    });
    expect(mocks.middleware).not.toHaveBeenCalled();
  });
});
