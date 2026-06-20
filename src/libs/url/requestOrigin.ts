const getDefaultAppUrl = () => {
  if (process.env.APP_URL) return process.env.APP_URL;
  const port = process.env.PORT || (process.env.NODE_ENV === 'development' ? '3010' : '3210');
  return `http://localhost:${port}`;
};

const firstHeaderValue = (value: string | null | undefined) =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .find(Boolean);

const normalizeOrigin = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return new URL(getDefaultAppUrl()).origin;
  }
};

const parseHost = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const isHostAllowed = (host: string) => {
  const allowed = process.env.APP_URL_ALLOWED_HOSTS?.trim();
  if (!allowed) return false;
  if (allowed === '*') return true;

  const normalizedHost = host.toLowerCase();
  const hostname = parseHost(host);

  return allowed.split(',').some((item) => {
    const rule = item.trim().toLowerCase();
    if (!rule) return false;
    if (rule === '*') return true;
    if (rule === normalizedHost || rule === hostname) return true;

    if (rule.startsWith('*.') && hostname) {
      const suffix = rule.slice(1);
      return hostname.endsWith(suffix);
    }

    return false;
  });
};

export const isDynamicRequestOriginEnabled = () => process.env.APP_URL_DYNAMIC === '1';

export const getRequestOriginFromHeaders = (
  headers: Headers,
  options: { fallbackUrl?: string; port?: string } = {},
) => {
  const fallbackOrigin = normalizeOrigin(options.fallbackUrl || getDefaultAppUrl());
  if (!isDynamicRequestOriginEnabled()) return fallbackOrigin;

  const fallbackUrl = new URL(fallbackOrigin);
  const host = firstHeaderValue(headers.get('x-forwarded-host')) || headers.get('host');
  if (!host || !isHostAllowed(host)) return fallbackOrigin;

  const proto =
    firstHeaderValue(headers.get('x-forwarded-proto')) || fallbackUrl.protocol.replace(':', '');
  const safeProto = proto === 'https' ? 'https' : 'http';

  try {
    const url = new URL(`${safeProto}://${host}`);
    if (options.port) url.port = options.port;
    return url.origin;
  } catch {
    return fallbackOrigin;
  }
};

export const getRequestOrigin = (
  request: Request,
  options: { fallbackUrl?: string; port?: string } = {},
) => {
  const headers = new Headers(request.headers);
  if (!headers.get('host')) {
    try {
      headers.set('host', new URL(request.url).host);
    } catch {
      // Keep the original headers and let getRequestOriginFromHeaders fall back.
    }
  }

  return getRequestOriginFromHeaders(headers, options);
};
