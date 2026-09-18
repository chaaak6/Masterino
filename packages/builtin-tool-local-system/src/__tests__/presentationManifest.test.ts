import { describe, expect, it } from 'vitest';

import { LocalSystemManifest } from '../manifest';

describe('local presentation tools', () => {
  it('publishes the complete local presentation workflow to the agent', () => {
    const names = LocalSystemManifest.api.map((api) => api.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'createPresentation',
        'inspectPresentation',
        'renderPresentationPreview',
        'revisePresentation',
        'validatePresentation',
      ]),
    );
    const create = LocalSystemManifest.api.find((api) => api.name === 'createPresentation');
    expect(create).toMatchObject({
      humanIntervention: { dynamic: { type: 'pathScopeAudit' } },
      parameters: {
        required: ['path', 'deck'],
        properties: {
          deck: {
            required: ['slides', 'theme'],
            properties: { slides: { maxItems: 100, minItems: 1 } },
          },
        },
      },
    });
  });
});
