const CREDENTIAL_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.npmrc',
  '.pypirc',
  'credentials',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'known_hosts',
  'netrc',
]);

/** Credential and key material still needs an explicit one-shot approval, including auto-run. */
export const isCredentialFilesystemPath = (target: string): boolean => {
  const normalized = target.replaceAll('\\', '/');
  const basename = normalized.split('/').at(-1)?.toLowerCase() ?? '';
  if (CREDENTIAL_BASENAMES.has(basename)) return true;
  if (/\.env(?:\.[^/]+)?$/i.test(basename)) return true;
  return /(?:^|\/)\.aws\/credentials$/i.test(normalized);
};

/**
 * Ordinary out-of-workspace reads/writes skip the card in auto-run/headless.
 * Credential paths still pause in auto-run. Headless has no UI, so it fail-closes.
 */
export const shouldPauseForPathConsent = (
  approvalMode: string | undefined,
  requestedPath?: string,
): boolean => {
  const mode = approvalMode ?? 'manual';
  if (mode === 'headless') return false;
  if (mode === 'auto-run') {
    return Boolean(requestedPath && isCredentialFilesystemPath(requestedPath));
  }
  return true;
};
