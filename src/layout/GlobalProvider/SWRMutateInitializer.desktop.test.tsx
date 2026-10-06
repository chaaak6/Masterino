import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import SWRMutateInitializer from './SWRMutateInitializer.desktop';

const { initializeAppState } = vi.hoisted(() => ({ initializeAppState: vi.fn() }));

vi.mock('@lobechat/electron-client-ipc', () => ({ useWatchBroadcast: vi.fn() }));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: unknown) => unknown) =>
    selector({ useInitElectronAppState: initializeAppState }),
}));

it('initializes desktop app state before exposing the agent environment', () => {
  render(<SWRMutateInitializer>Desktop</SWRMutateInitializer>);
  expect(initializeAppState).toHaveBeenCalled();
});
