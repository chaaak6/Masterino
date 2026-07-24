// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

type RouteHandler = (request: Request) => Promise<Response>;

const mocks = vi.hoisted(() => ({
  authEnv: {
    AUTH_DISABLE_EMAIL_PASSWORD: false,
    AUTH_DISABLE_EMAIL_SIGNUP: false,
  },
  createAuth: vi.fn((options?: unknown) => ({ dynamicAuth: true, options })),
  get: vi.fn<RouteHandler>(async () => Response.json({ ok: true })),
  post: vi.fn<RouteHandler>(async () => Response.json({ ok: true })),
}));

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: vi.fn(() => ({
    GET: mocks.get,
    POST: mocks.post,
  })),
}));

vi.mock('@/auth', () => ({
  auth: {},
  createAuth: mocks.createAuth,
}));

vi.mock('@/envs/auth', () => ({
  authEnv: mocks.authEnv,
}));

const createPostRequest = (body: string, contentType = 'application/json') =>
  new Request('https://localhost/api/auth/sign-in/email', {
    body,
    headers: { 'Content-Type': contentType },
    method: 'POST',
  }) as NextRequest;

describe('/api/auth/[...all] route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.authEnv.AUTH_DISABLE_EMAIL_PASSWORD = false;
    mocks.authEnv.AUTH_DISABLE_EMAIL_SIGNUP = false;
    mocks.get.mockResolvedValue(Response.json({ ok: true }));
    mocks.post.mockResolvedValue(Response.json({ ok: true }));
  });

  it('returns 400 for malformed JSON auth requests before Better Auth handles them', async () => {
    const response = await POST(
      createPostRequest('{"email":"user@example.com","password":"secret",}'),
    );

    await expect(response.json()).resolves.toEqual({
      code: 'INVALID_JSON',
      message: 'Malformed JSON request body',
    });
    expect(response.status).toBe(400);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it.each([['AUTH_DISABLE_EMAIL_SIGNUP'], ['AUTH_DISABLE_EMAIL_PASSWORD']] as const)(
    'hides the email signup endpoint when %s is enabled',
    async (flag) => {
      mocks.authEnv[flag] = true;

      const response = await POST(
        new Request('https://localhost/api/auth/sign-up/email', {
          body: JSON.stringify({ email: 'known@example.com', password: 'secret' }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }) as NextRequest,
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ code: 'NOT_FOUND', message: 'Not found' });
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it('passes valid JSON auth requests through without consuming the original body', async () => {
    mocks.post.mockImplementationOnce(async (request: Request) =>
      Response.json(await request.json()),
    );

    const response = await POST(
      createPostRequest(JSON.stringify({ email: 'user@example.com', password: 'secret' })),
    );

    await expect(response.json()).resolves.toEqual({
      email: 'user@example.com',
      password: 'secret',
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('delegates non-JSON auth requests to Better Auth', async () => {
    const response = await POST(
      createPostRequest(
        'email=user%40example.com&password=secret',
        'application/x-www-form-urlencoded',
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('delegates GET requests to Better Auth', async () => {
    const request = new Request('https://localhost/api/auth/get-session') as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith(request);
  });

  it('expires legacy readable session-data cookies on the next auth request', async () => {
    const request = new Request('https://localhost/api/auth/get-session', {
      headers: {
        cookie:
          '__Secure-better-auth.session_data=sensitive-cache; better-auth.session_data=legacy-cache',
      },
    }) as NextRequest;

    const response = await GET(request);
    const setCookie = response.headers.get('set-cookie');

    expect(setCookie).toContain('__Secure-better-auth.session_data=');
    expect(setCookie).toContain('better-auth.session_data=');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).not.toContain('sensitive-cache');
    expect(setCookie).not.toContain('legacy-cache');
  });

  it('does not emit cleanup cookies when no legacy session-data cookie is present', async () => {
    const request = new Request('https://localhost/api/auth/get-session', {
      headers: { cookie: 'better-auth.session_token=active-session' },
    }) as NextRequest;

    const response = await GET(request);

    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('creates a request-origin auth handler when dynamic origins are enabled', async () => {
    vi.stubEnv('APP_URL_DYNAMIC', '1');
    vi.stubEnv('APP_URL_ALLOWED_HOSTS', '*');
    const request = new Request('http://internal:3210/api/auth/sign-in/email', {
      headers: {
        'host': 'internal:3210',
        'x-forwarded-host': 'chat.example.com',
        'x-forwarded-proto': 'https',
      },
    }) as NextRequest;

    await GET(request);

    expect(mocks.createAuth).toHaveBeenCalledWith({
      baseURL: 'https://chat.example.com',
      trustedOrigins: ['https://chat.example.com'],
    });
  });
});
