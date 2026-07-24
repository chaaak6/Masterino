import { toNextJsHandler } from 'better-auth/next-js';
import type { NextRequest } from 'next/server';

import { auth, createAuth } from '@/auth';
import { authEnv } from '@/envs/auth';
import { getRequestOrigin, isDynamicRequestOriginEnabled } from '@/libs/url/requestOrigin';

const jsonContentTypeRegex = /^application\/(?:[a-z0-9.+-]*\+)?json/i;

const handler = toNextJsHandler(auth);
const dynamicHandlerCache = new Map<string, ReturnType<typeof toNextJsHandler>>();
const legacySessionDataCookieNames = [
  '__Secure-better-auth.session_data',
  'better-auth.session_data',
];

const getHandler = (request: Request) => {
  if (!isDynamicRequestOriginEnabled()) return handler;

  const origin = getRequestOrigin(request);
  const cached = dynamicHandlerCache.get(origin);
  if (cached) return cached;

  const nextHandler = toNextJsHandler(createAuth({ baseURL: origin, trustedOrigins: [origin] }));
  dynamicHandlerCache.set(origin, nextHandler);

  return nextHandler;
};

const malformedJsonResponse = () =>
  Response.json({ code: 'INVALID_JSON', message: 'Malformed JSON request body' }, { status: 400 });

const logBlockedEmailSignup = () => {
  console.warn(
    JSON.stringify({
      component: 'auth',
      event: 'security.email_signup_blocked',
      reason: 'signup_disabled',
      severity: 'warning',
    }),
  );
};

const clearLegacySessionDataCookies = (request: Request, response: Response) => {
  const requestCookies = request.headers.get('cookie');
  if (!requestCookies) return response;

  const cookieNames = new Set(
    requestCookies
      .split(';')
      .map((cookie) => cookie.trim().split('=', 1)[0])
      .filter(Boolean),
  );
  const cookiesToClear = legacySessionDataCookieNames.filter((name) => cookieNames.has(name));
  if (cookiesToClear.length === 0) return response;

  const headers = new Headers(response.headers);
  for (const name of cookiesToClear) {
    const secure = name.startsWith('__Secure-') ? '; Secure' : '';
    headers.append(
      'Set-Cookie',
      `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`,
    );
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

/**
 * better-call currently treats Request.json() SyntaxError as a server error.
 * Validate JSON bodies at the route boundary so malformed client payloads stay 400s.
 */
const validateJsonBody = async (request: Request) => {
  const contentType = request.headers.get('content-type') || '';
  if (!request.body || !jsonContentTypeRegex.test(contentType)) return;

  try {
    await request.clone().json();
  } catch (error) {
    if (error instanceof SyntaxError) return malformedJsonResponse();
    throw error;
  }
};

export const GET = async (request: NextRequest) =>
  clearLegacySessionDataCookies(request, await getHandler(request).GET(request));

export const POST = async (request: NextRequest) => {
  const pathname = new URL(request.url).pathname;
  if (
    pathname === '/api/auth/sign-up/email' &&
    (authEnv.AUTH_DISABLE_EMAIL_PASSWORD || authEnv.AUTH_DISABLE_EMAIL_SIGNUP)
  ) {
    // Deliberately omit the submitted body, email address, cookies, and client
    // address. Ingress logs retain request metadata for operational correlation.
    logBlockedEmailSignup();
    return clearLegacySessionDataCookies(
      request,
      Response.json({ code: 'NOT_FOUND', message: 'Not found' }, { status: 404 }),
    );
  }

  const invalidJsonResponse = await validateJsonBody(request);
  if (invalidJsonResponse) return clearLegacySessionDataCookies(request, invalidJsonResponse);

  return clearLegacySessionDataCookies(request, await getHandler(request).POST(request));
};
