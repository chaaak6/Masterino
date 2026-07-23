import { describe, expect, it } from 'vitest';

import {
  getProductFeature,
  getProductFeatureStatus,
  isProductFeatureDisabled,
  isProductFeatureEnabled,
  isProductFeatureHidden,
} from './productFeatures';

describe('product feature convergence config', () => {
  it('keeps the available product surfaces enabled', () => {
    expect(isProductFeatureEnabled('chat')).toBe(true);
    expect(isProductFeatureEnabled('generation')).toBe(true);
    expect(isProductFeatureEnabled('groupChat')).toBe(true);
  });

  it('keeps complex non-core user features visible but disabled', () => {
    expect(getProductFeatureStatus('community')).toBe('disabled');
    expect(getProductFeatureStatus('desktopApp')).toBe('disabled');
    expect(getProductFeatureStatus('resources')).toBe('disabled');
    expect(getProductFeatureStatus('pages')).toBe('disabled');
    expect(getProductFeatureStatus('memory')).toBe('disabled');
    expect(getProductFeatureStatus('tasks')).toBe('disabled');
    expect(isProductFeatureDisabled('community')).toBe(true);
  });

  it('hides internal developer and evaluation surfaces', () => {
    expect(isProductFeatureHidden('eval')).toBe(true);
    expect(isProductFeatureHidden('devtools')).toBe(true);
  });

  it('provides a stable disabled reason for greyed entries', () => {
    expect(getProductFeature('pages').disabledReasonKey).toBe('productFeatures.disabled');
    expect(getProductFeature('desktopApp').disabledReasonKey).toBe('productFeatures.disabled');
  });
});
