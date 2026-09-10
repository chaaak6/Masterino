import { describe, expect, it } from 'vitest';

import { curatedResources } from './curatedCatalog.js';
import {
  ONBOARDING_AGENT_CATALOG,
  ONBOARDING_AGENT_IDENTIFIERS,
  resolveMarketAvatar,
} from './onboardingCatalog.js';

describe('onboarding agent catalog', () => {
  it('defines exactly eight unique templates with supported categories and relative avatars', () => {
    expect(ONBOARDING_AGENT_CATALOG).toHaveLength(8);
    expect(new Set(ONBOARDING_AGENT_IDENTIFIERS).size).toBe(8);
    expect(
      ONBOARDING_AGENT_CATALOG.every((entry) =>
        [
          'business-strategy',
          'content-creation',
          'engineering',
          'learning-research',
          'operations',
          'product-management',
        ].includes(entry.category),
      ),
    ).toBe(true);
    expect(
      ONBOARDING_AGENT_CATALOG.every((entry) =>
        entry.avatar.match(/^\/assets\/agent-avatars\/v\d+\/[\w-]+\.svg$/),
      ),
    ).toBe(true);
  });

  it('keeps curated seed metadata aligned with the onboarding contract', () => {
    const seededByIdentifier = new Map(
      curatedResources
        .filter((entry) => entry.type === 'agent')
        .map((entry) => [entry.resource.identifier, entry.resource]),
    );

    for (const entry of ONBOARDING_AGENT_CATALOG) {
      expect(seededByIdentifier.get(entry.identifier)).toMatchObject({
        avatar: entry.avatar,
        category: entry.category,
        version: entry.seedVersion,
      });
    }
  });

  it('resolves only built-in relative avatar paths against the current Market environment', () => {
    expect(
      resolveMarketAvatar(
        '/assets/agent-avatars/v1/writing.svg',
        'https://mlai-test.bielcrystal.com/market',
      ),
    ).toBe('https://mlai-test.bielcrystal.com/market/assets/agent-avatars/v1/writing.svg');
    expect(
      resolveMarketAvatar('https://cdn.example.com/custom.png', 'https://market.example.com'),
    ).toBe('https://cdn.example.com/custom.png');
    expect(resolveMarketAvatar('🦁', 'https://market.example.com')).toBe('🦁');
    expect(resolveMarketAvatar('/user-content/custom.png', 'https://market.example.com')).toBe(
      '/user-content/custom.png',
    );
  });
});
