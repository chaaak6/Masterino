// Next.js routes that must NOT go to SPA catch-all.
// Shared between middleware (define-config.ts) and the client Link adapter.
export const nextjsOnlyRoutes = [
  '/discover',
  // OAuth API routes (route handlers in src/app/(backend)/oauth/) must not be
  // rewritten to the SPA catch-all — they issue redirects / JSON responses.
  '/oauth/wecom',
  '/oauth/connector',
];

// Routes served by the standalone auth SPA (/spa-auth). The main SPA must
// hard-navigate to them (cross-app), so the Link adapter treats them like
// nextjsOnlyRoutes.
export const authSpaRoutes = [
  '/signin',
  '/signup',
  '/auth-error',
  '/reset-password',
  '/verify-email',
  '/oauth/consent',
  '/market-auth-callback',
];
