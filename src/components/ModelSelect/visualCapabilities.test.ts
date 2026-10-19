import type { ChatInputModalityConclusion } from '@lobechat/types/src/modelCatalog';
import { describe, expect, it } from 'vitest';

import { getVisualCapabilities } from './visualCapabilities';

const unknown = {
  evidence: {
    image: { state: 'unknown' },
    video: { state: 'unknown' },
  },
} as ChatInputModalityConclusion;

describe('model picker visual capabilities', () => {
  it('uses the existing model bank only as a display fallback for Aihub models', () => {
    expect(getVisualCapabilities('glm-5.3-flash', 'newapi', {}, unknown)).toEqual({
      image: true,
      video: true,
    });
    expect(getVisualCapabilities('glm-5.3-flash', 'other', {}, unknown)).toEqual({
      image: false,
      video: false,
    });
  });

  it('lets published conclusions override fallback icons', () => {
    expect(
      getVisualCapabilities('glm-5.3-flash', 'newapi', {}, unknown, 'unsupported', 'unsupported'),
    ).toEqual({ image: false, video: false });
  });
});
