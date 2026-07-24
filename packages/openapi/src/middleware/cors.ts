const normalizeOrigin = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return;
  }
};

const getAllowedOrigins = () => {
  const configuredOrigins = process.env.OPENAPI_CORS_ALLOWED_ORIGINS?.split(',') ?? [];
  const origins = [process.env.APP_URL, ...configuredOrigins]
    .filter((origin): origin is string => !!origin && origin.trim() !== '*')
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => !!origin);

  return new Set(origins);
};

export const openApiCorsOptions = {
  allowHeaders: ['Authorization', 'Content-Type', 'X-Workspace-Id'],
  maxAge: 600,
  origin: (origin: string) => {
    const normalizedOrigin = normalizeOrigin(origin);
    return normalizedOrigin && getAllowedOrigins().has(normalizedOrigin) ? origin : null;
  },
};
