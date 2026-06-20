import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

const readSource = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('about settings convergence', () => {
  it('hides business, social, legal, changelog, and update actions', () => {
    const about = readSource('src/routes/(main)/settings/about/features/About.tsx');
    const version = readSource('src/routes/(main)/settings/about/features/Version.tsx');

    expect(about).not.toContain('mail.business');
    expect(about).not.toContain('SiDiscord');
    expect(about).not.toContain('SiX');
    expect(about).not.toContain('SiYoutube');
    expect(about).not.toContain("t('legal')");
    expect(about).not.toContain('TERMS_URL');
    expect(about).not.toContain('PRIVACY_URL');

    expect(version).not.toContain('CHANGELOG_URL');
    expect(version).not.toContain('MANUAL_UPGRADE_URL');
    expect(version).not.toContain('useCheckServerVersion');
    expect(version).not.toContain('autoUpdateService');
    expect(version).not.toContain('checkUpdate');
    expect(version).not.toContain('useNewVersion');
  });
});
