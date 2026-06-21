import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePanelHandlers } from './usePanelHandlers';

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) =>
    selector({
      updateAgentConfig: vi.fn(),
    }),
}));

describe('usePanelHandlers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits Aihub model ids without provider-specific rewriting', () => {
    const onModelChange = vi.fn();
    const { result } = renderHook(() => usePanelHandlers({ onModelChange }));

    act(() => {
      result.current.handleModelChange('glm5-5.1', 'newapi');
      vi.advanceTimersByTime(150);
    });

    expect(onModelChange).toHaveBeenCalledWith({ model: 'glm5-5.1', provider: 'newapi' });
  });
});
