import { act, renderHook } from '@testing-library/react';
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import { useUserStore } from '@/store/user';

import { useMenu } from '../UserPanel/useMenu';
import { useNewVersion } from '../UserPanel/useNewVersion';

const wrapper: React.JSXElementConstructor<{ children: React.ReactNode }> = ({ children }) => (
  <ServerConfigStoreProvider>{children}</ServerConfigStoreProvider>
);

// Mock dependencies
vi.mock('next/link', () => ({
  default: vi.fn(({ children }) => <div>{children}</div>),
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: vi.fn(() => ({
    push: vi.fn(),
  })),
}));

vi.mock('@/hooks/useInterceptingRoutes', () => ({
  useOpenSettings: vi.fn(() => vi.fn()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: vi.fn((key) => key),
  })),
}));

vi.mock('@/services/config', () => ({
  configService: {
    exportAgents: vi.fn(),
    exportAll: vi.fn(),
    exportSessions: vi.fn(),
    exportSettings: vi.fn(),
  },
}));

vi.mock('../UserPanel/useNewVersion', () => ({
  useNewVersion: vi.fn(() => false),
}));

const readReactText = (node: unknown): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(readReactText).join('');
  if (isValidElement(node)) return readReactText((node.props as any).children);
  return '';
};

const getMenuItem = (items: ReturnType<typeof useMenu>['mainItems'], key: string) =>
  items?.find((menuItem) => menuItem?.key === key) as
    | ({ disabled?: boolean; label?: unknown } & Record<string, unknown>)
    | undefined;

describe('useMenu', () => {
  it('should provide correct menu items when user is logged in with auth', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    const { result } = renderHook(() => useMenu(), { wrapper });

    act(() => {
      const { mainItems, logoutItems } = result.current;
      // 'setting' is shown when logged in
      expect(mainItems?.some((item) => item?.key === 'setting')).toBe(true);
      // 'memory' is gated behind the showMemory nav-layout flag (defaults off)
      expect(mainItems?.some((item) => item?.key === 'memory')).toBe(false);
      // 'logout' is shown when isLoginWithAuth is true
      expect(logoutItems.some((item) => item?.key === 'logout')).toBe(true);
    });
  });

  it('should provide correct menu items when user is not logged in', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false });
    });

    const { result } = renderHook(() => useMenu(), { wrapper });

    act(() => {
      const { mainItems, logoutItems } = result.current;
      // When not logged in, setting and memory should not be shown
      expect(mainItems?.some((item) => item?.key === 'setting')).toBe(false);
      expect(mainItems?.some((item) => item?.key === 'memory')).toBe(false);
      expect(logoutItems.some((item) => item?.key === 'logout')).toBe(false);
    });
  });

  it('should not have consecutive dividers in mainItems', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    const { result } = renderHook(() => useMenu(), { wrapper });

    act(() => {
      const { mainItems } = result.current;
      if (!mainItems) return;

      for (let i = 1; i < mainItems.length; i++) {
        const prev = mainItems[i - 1];
        const curr = mainItems[i];
        const isDivider = (item: any) =>
          item && typeof item === 'object' && item.type === 'divider';
        expect(isDivider(prev) && isDivider(curr)).toBe(false);
      }
    });
  });

  it('keeps the desktop app menu item visible but disabled while desktop app is unavailable', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    const { result } = renderHook(() => useMenu(), { wrapper });

    const item = getMenuItem(result.current.mainItems, 'get-desktop-app');

    expect(item).toBeTruthy();
    expect(item).toMatchObject({ disabled: true });
    expect(readReactText(item?.label)).toContain('getDesktopApp');
    expect(readReactText(item?.label)).toContain('productFeatures.disabled');
    expect((item?.label as any)?.props?.style).toMatchObject({
      alignItems: 'center',
      display: 'flex',
      width: '100%',
    });
    const status = (item?.label as any)?.props?.children?.[1];
    expect(status?.props?.style).toMatchObject({
      fontSize: 12,
      marginInlineStart: 'auto',
      whiteSpace: 'nowrap',
    });
    expect((item?.label as any)?.props?.href).toBeUndefined();
  });

  it('does not render the available update badge in the settings menu item', () => {
    vi.mocked(useNewVersion).mockReturnValue(true);

    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    const { result } = renderHook(() => useMenu(), { wrapper });

    const item = getMenuItem(result.current.mainItems, 'setting');
    const badge = (item?.label as any)?.props?.children;

    expect(badge?.props?.showBadge).not.toBe(true);

    vi.mocked(useNewVersion).mockReturnValue(false);
  });
});
