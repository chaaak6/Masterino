export const LOCAL_FILE_PROTOCOL_SCHEME = 'localfile';
export const LOCAL_FILE_PROTOCOL_HOST = 'file';

/**
 * Renderer pathnames that must be proxied to the remote Masterino backend
 * instead of being served as static assets. Covers tRPC, webapi, NextAuth,
 * object-storage uploads, and the marketplace REST + OIDC token/userinfo/handoff endpoints.
 *
 * `/lobehub-oidc/*` is intentionally NOT here — those URLs are handed to
 * `shell.openExternal` as fully-qualified web URLs and never reach renderer
 * `fetch`.
 */
export const BACKEND_PATH_PREFIXES = [
  '/trpc',
  '/webapi',
  '/api/auth',
  '/api/market/skills',
  '/market',
];
export const BACKEND_EXACT_PATHS = ['/api/upload/s3-proxy', '/api/agent/events'];

export const isBackendPath = (pathname: string) =>
  BACKEND_EXACT_PATHS.includes(pathname) ||
  BACKEND_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
