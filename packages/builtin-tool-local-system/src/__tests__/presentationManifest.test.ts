import Ajv from 'ajv';
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

  it('uses a discriminated element schema that rejects missing type-specific fields', () => {
    const create = LocalSystemManifest.api.find((api) => api.name === 'createPresentation')!;
    const validate = new Ajv({ strict: false }).compile(create.parameters);
    expect(
      validate({
        path: 'bad.pptx',
        deck: {
          slides: [
            {
              id: 's1',
              elements: [{ id: 'e1', type: 'table', frame: { x: 0, y: 0, w: 1, h: 1 } }],
            },
          ],
          theme: {
            colors: {
              primary: '000000',
              accent: '000000',
              text: '000000',
              muted: '000000',
              background: 'FFFFFF',
            },
            fonts: { heading: 'Arial', body: 'Arial' },
          },
        },
      }),
    ).toBe(false);
  });
});
