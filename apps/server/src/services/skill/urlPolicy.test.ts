// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getAllowedRemoteSkillOrigins, isRemoteSkillUrlAllowed } from './urlPolicy';

describe('remote skill URL policy', () => {
  it('fails closed when no origins are configured', () => {
    expect(isRemoteSkillUrlAllowed(new URL('https://example.com/SKILL.md'), '')).toBe(false);
  });

  it('allows only exact configured HTTPS origins', () => {
    const configured = 'https://skills.example.com, https://cdn.example.com:8443/';

    expect(
      isRemoteSkillUrlAllowed(new URL('https://skills.example.com/SKILL.md'), configured),
    ).toBe(true);
    expect(
      isRemoteSkillUrlAllowed(new URL('https://cdn.example.com:8443/skill.zip'), configured),
    ).toBe(true);
    expect(
      isRemoteSkillUrlAllowed(new URL('https://sub.skills.example.com/SKILL.md'), configured),
    ).toBe(false);
    expect(isRemoteSkillUrlAllowed(new URL('https://cdn.example.com/skill.zip'), configured)).toBe(
      false,
    );
  });

  it('ignores unsafe or malformed configuration entries', () => {
    const origins = getAllowedRemoteSkillOrigins(
      '*,http://skills.example.com,https://user:pass@skills.example.com,https://skills.example.com/path,not-a-url',
    );

    expect([...origins]).toEqual([]);
  });

  it('normalizes default HTTPS ports', () => {
    expect(
      isRemoteSkillUrlAllowed(
        new URL('https://skills.example.com/SKILL.md'),
        'https://skills.example.com:443',
      ),
    ).toBe(true);
  });
});
