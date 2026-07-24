const parseConfiguredOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value.trim());

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return;
    }

    return url.origin;
  } catch {
    return;
  }
};

export const getAllowedRemoteSkillOrigins = (
  configuredOrigins = process.env.SKILL_IMPORT_ALLOWED_ORIGINS,
): Set<string> => {
  if (!configuredOrigins) return new Set();

  return new Set(
    configuredOrigins
      .split(',')
      .map(parseConfiguredOrigin)
      .filter((origin): origin is string => Boolean(origin)),
  );
};

export const isRemoteSkillUrlAllowed = (
  url: URL,
  configuredOrigins = process.env.SKILL_IMPORT_ALLOWED_ORIGINS,
): boolean => getAllowedRemoteSkillOrigins(configuredOrigins).has(url.origin);
