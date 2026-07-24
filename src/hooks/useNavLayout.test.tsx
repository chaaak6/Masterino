import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface GlobalStateMock {
  toggleCommandMenu: () => void;
}

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  enableMemory: false,
  showMarket: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/config/routes', () => ({
  getRouteById: (id: string) => ({
    icon: () => id,
  }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: GlobalStateMock) => unknown) =>
    selector({ toggleCommandMenu: vi.fn() }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: {},
  useServerConfigStore: () => ({
    hideGitHub: false,
    enableMemory: mocks.enableMemory,
    showMarket: mocks.showMarket,
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

describe('useNavLayout', () => {
  beforeEach(() => {
    mocks.activeWorkspaceSlug = null;
    mocks.showMarket = true;
    mocks.enableMemory = false;
  });

  it('hides Memory while the runtime flag is disabled', async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).toBe(true);
  });

  it('shows Memory in personal mode when runtime flag is enabled', async () => {
    mocks.enableMemory = true;

    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).not.toBe(true);
    expect(memoryItem?.disabled).toBe(false);
  });

  it('hides Memory in workspace mode', async () => {
    mocks.activeWorkspaceSlug = 'lobe-team';
    mocks.enableMemory = true;

    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).toBe(true);
  });

  it('enables generation while greying unavailable navigation entries', async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const entries = [...result.current.topNavItems, ...result.current.bottomMenuItems];

    expect(entries.find((item) => item.key === 'tasks')).toMatchObject({ disabled: true });
    expect(entries.find((item) => item.key === 'pages')).toMatchObject({ disabled: true });
    expect(entries.find((item) => item.key === 'image')).toMatchObject({ disabled: false });
    expect(entries.find((item) => item.key === 'community')).toMatchObject({ disabled: true });
    expect(entries.find((item) => item.key === 'resource')).toMatchObject({ disabled: true });
    expect(entries.find((item) => item.key === 'memory')).toMatchObject({ disabled: false });
  });
});
