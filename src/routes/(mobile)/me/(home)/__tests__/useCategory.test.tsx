import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type * as ConstVersionModule from '@/const/version';
import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import { useUserStore } from '@/store/user';

import { useCategory } from '../features/useCategory';

const wrapper: React.JSXElementConstructor<{ children: React.ReactNode }> = ({ children }) => (
  <ServerConfigStoreProvider>{children}</ServerConfigStoreProvider>
);

// Mock dependencies
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: vi.fn((key) => key),
  })),
}));

// Mock version constants
vi.mock('@/const/version', async (importOriginal) => {
  const actual = await importOriginal<typeof ConstVersionModule>();
  return {
    ...actual,
    isServerMode: false,
  };
});

afterEach(() => {
  mockNavigate.mockReset();
});

describe('useCategory', () => {
  it('should return correct items when the user is logged in with authentication', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    const { result } = renderHook(() => useCategory(), { wrapper });

    act(() => {
      const items = result.current;
      const getApp = items.find((item) => item.key === 'get-app');
      const docs = items.find((item) => item.key === 'docs');
      const feedback = items.find((item) => item.key === 'feedback');

      expect(items.some((item) => item.key === 'profile')).toBe(true);
      expect(items.some((item) => item.key === 'setting')).toBe(true);
      expect(getApp).toMatchObject({
        disabled: true,
        extra: 'productFeatures.disabled',
        label: 'getApp',
      });
      expect(docs).toMatchObject({ disabled: true, extra: 'productFeatures.disabled' });
      expect(feedback).toMatchObject({ disabled: true, extra: 'productFeatures.disabled' });
      expect(items.some((item) => item.key === 'changelog')).toBe(false);
    });
  });

  it('should return correct items when the user is not logged in', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false });
    });

    const { result } = renderHook(() => useCategory(), { wrapper });

    act(() => {
      const items = result.current;
      const getApp = items.find((item) => item.key === 'get-app');
      const docs = items.find((item) => item.key === 'docs');
      const feedback = items.find((item) => item.key === 'feedback');

      expect(items.some((item) => item.key === 'profile')).toBe(false);
      expect(items.some((item) => item.key === 'setting')).toBe(false);
      expect(items.some((item) => item.key === 'data')).toBe(false);
      expect(getApp).toMatchObject({
        disabled: true,
        extra: 'productFeatures.disabled',
        label: 'getApp',
      });
      expect(docs).toMatchObject({ disabled: true, extra: 'productFeatures.disabled' });
      expect(feedback).toMatchObject({ disabled: true, extra: 'productFeatures.disabled' });
      expect(items.some((item) => item.key === 'changelog')).toBe(false);
    });
  });
});
