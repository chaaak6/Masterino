const PUBLIC_AUTH_ERROR_CODES = new Set([
  'EMAIL_NOT_VERIFIED',
  'INVALID_TOKEN',
  'PROVIDER_NOT_FOUND',
  'RATE_LIMIT_EXCEEDED',
  'SESSION_EXPIRED',
  'USER_BANNED',
]);

export const getPublicAuthErrorCode = (value?: string | null): string => {
  if (!value || value.length > 64) return 'UNKNOWN';

  const normalized = value.trim().toUpperCase().replaceAll('-', '_');
  if (!/^[A-Z0-9_]+$/.test(normalized)) return 'UNKNOWN';

  return PUBLIC_AUTH_ERROR_CODES.has(normalized) ? normalized : 'UNKNOWN';
};
