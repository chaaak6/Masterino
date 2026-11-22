// These schemes only activate the desktop window. OAuth still completes over HTTPS.
const desktopSchemes = new Set([
  'lobehub',
  'lobehub-beta',
  'lobehub-canary',
  'lobehub-dev',
  'lobehub-nightly',
  'masterino-test',
]);

export const getDesktopAuthorizationScheme = (value: string | null): string | undefined =>
  value && desktopSchemes.has(value) ? value : undefined;
