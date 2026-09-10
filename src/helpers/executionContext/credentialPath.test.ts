import { describe, expect, it } from 'vitest';

import { isCredentialFilesystemPath, shouldPauseForPathConsent } from './credentialPath';

describe('credentialPath', () => {
  it.each(['/workspace/.env', '/home/me/.npmrc', '/home/me/.aws/credentials'])(
    'recognizes %s as credential material',
    (target) => {
      expect(isCredentialFilesystemPath(target)).toBe(true);
    },
  );

  it('does not treat ordinary files as credentials', () => {
    expect(isCredentialFilesystemPath('/tmp/report.xlsx')).toBe(false);
  });

  it('pauses auto-run only for credential paths', () => {
    expect(shouldPauseForPathConsent('auto-run', '/tmp/report.xlsx')).toBe(false);
    expect(shouldPauseForPathConsent('auto-run', '/workspace/.env')).toBe(true);
    expect(shouldPauseForPathConsent('headless', '/workspace/.env')).toBe(false);
    expect(shouldPauseForPathConsent('manual', '/tmp/report.xlsx')).toBe(true);
  });
});
