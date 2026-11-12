import { render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import StoreInitialization from './StoreInitialization';

const mocks = vi.hoisted(() => ({
  active: false,
  initialized: false,
  userInit: vi.fn(),
  agentInit: vi.fn(),
  nativeConfig: vi.fn(),
}));
vi.mock('@/const/version', () => ({ isDesktop: true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({}) }));
vi.mock('zustand-utils', () => ({ createStoreUpdater: () => () => {} }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('./useUserStateRedirect', () => ({ useUserStateRedirect: () => undefined }));
vi.mock('./DeferredStoreInitialization', () => ({ default: () => null }));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: unknown) => unknown) =>
    selector({
      isInitRemoteServerConfig: mocks.initialized,
      dataSyncConfig: { active: mocks.active, storageMode: 'cloud' },
      useDataSyncConfig: mocks.nativeConfig,
    }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({
      isSignedIn: true,
      useInitUserState: mocks.userInit,
    }),
}));
vi.mock('@/store/user/selectors', () => ({ authSelectors: { isLogin: () => true } }));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ useInitBuiltinAgent: mocks.agentInit }),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) =>
    selector({ useInitSystemStatus: () => {}, useCheckServerVersion: () => {} }),
}));
vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: { oAuthSSOProviders: () => [] },
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector?: (state: unknown) => unknown) =>
    selector
      ? selector({ useInitServerConfig: () => {} })
      : { serverConfig: {}, useInitServerConfig: () => {} },
}));
beforeEach(() => {
  vi.clearAllMocks();
});

it.each([
  [false, true, false],
  [true, false, false],
  [true, true, true],
])(
  'initializes account data only after native config initialized=%s, active=%s',
  (initialized, active, enabled) => {
    mocks.initialized = initialized;
    mocks.active = active;
    render(<StoreInitialization />);
    expect(mocks.nativeConfig).toHaveBeenCalledWith(true);
    expect(mocks.userInit).toHaveBeenCalledWith(enabled, {}, expect.objectContaining({ enabled }));
    expect(mocks.agentInit).toHaveBeenCalledWith(expect.any(String), { isLogin: enabled });
  },
);
