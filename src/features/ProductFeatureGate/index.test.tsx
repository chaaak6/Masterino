import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { featureGateElement } from './index';

const mocks = vi.hoisted(() => ({
  enableMemory: false,
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: { featureFlags: { enableMemory: boolean } }) => state.featureFlags,
  useServerConfigStore: (
    selector: (state: { featureFlags: { enableMemory: boolean } }) => unknown,
  ) => selector({ featureFlags: { enableMemory: mocks.enableMemory } }),
}));

vi.mock('./FeatureDisabledPage', () => ({
  default: () => <div>feature-disabled</div>,
}));

const renderMemoryRoute = (path: string, routePath: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          element={featureGateElement('memory', <div>personal-memory</div>)}
          path={routePath}
        />
      </Routes>
    </MemoryRouter>,
  );

describe('personal memory product feature gate', () => {
  beforeEach(() => {
    mocks.enableMemory = false;
  });

  it('blocks the personal route when the runtime flag is disabled', () => {
    renderMemoryRoute('/memory', '/memory');

    expect(screen.getByText('feature-disabled')).toBeInTheDocument();
  });

  it('allows the personal route when the runtime flag is enabled', () => {
    mocks.enableMemory = true;

    renderMemoryRoute('/memory', '/memory');

    expect(screen.getByText('personal-memory')).toBeInTheDocument();
  });

  it('always blocks a workspace route even when the runtime flag is enabled', () => {
    mocks.enableMemory = true;

    renderMemoryRoute('/acme/memory', '/:workspaceSlug/memory');

    expect(screen.getByText('feature-disabled')).toBeInTheDocument();
  });
});
