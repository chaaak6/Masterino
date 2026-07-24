import { describe, expect, it } from 'vitest';

import { SIDEBAR_SPACER_ID } from '@/store/global/selectors/systemStatus';

import { getAvailableSidebarItems, getSortableSidebarItemIds } from './CustomizeSidebarModal';

describe('CustomizeSidebarModal', () => {
  it('keeps Memory available in personal mode when the runtime flag is enabled', () => {
    const items = getAvailableSidebarItems(false, true);

    expect(items.some((item) => item.id === 'memory')).toBe(true);
  });

  it('removes Memory by default and when the runtime flag is disabled', () => {
    expect(getAvailableSidebarItems(false).some((item) => item.id === 'memory')).toBe(false);
    expect(getAvailableSidebarItems(false, false).some((item) => item.id === 'memory')).toBe(false);
    expect(getSortableSidebarItemIds(false, false).has('memory')).toBe(false);
  });

  it('removes Memory from workspace mode customization', () => {
    const items = getAvailableSidebarItems(true);

    expect(items.some((item) => item.id === 'memory')).toBe(false);
  });

  it('keeps the spacer in the sortable item set', () => {
    expect(getSortableSidebarItemIds(false).has(SIDEBAR_SPACER_ID)).toBe(true);
    expect(getSortableSidebarItemIds(true).has(SIDEBAR_SPACER_ID)).toBe(true);
  });

  it('keeps workspace-only exclusions in the sortable item set', () => {
    expect(getSortableSidebarItemIds(false, true).has('memory')).toBe(true);
    expect(getSortableSidebarItemIds(true).has('memory')).toBe(false);
  });
});
