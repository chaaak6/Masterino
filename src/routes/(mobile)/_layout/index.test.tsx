import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  Outlet: () => <div>Protected mobile route</div>,
  useLocation: () => ({ pathname: '/' }),
}));

vi.mock('@/business/client/WorkspaceContextSlot', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: ({ debugId }: { debugId: string }) => <div data-debug-id={debugId}>Loading</div>,
}));

vi.mock('@/features/MobileAuthGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section data-testid="mobile-auth-guard">{children}</section>
  ),
}));

vi.mock('@/features/RouteMeta', () => ({
  RouteMetaBridge: () => null,
}));

vi.mock('@/layout/AuthProvider/MarketAuth', () => ({
  MarketAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/libs/next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: {},
  useServerConfigStore: () => ({ showCloudPromotion: false }),
}));

vi.mock('./NavBar', () => ({
  default: () => <nav>Mobile nav</nav>,
}));

import MobileMainLayout from './index';

describe('MobileMainLayout', () => {
  it('routes the mobile home outlet through the mobile auth guard', () => {
    render(<MobileMainLayout />);

    expect(screen.getByTestId('mobile-auth-guard')).toContainElement(
      screen.getByText('Protected mobile route'),
    );
    expect(screen.getByTestId('mobile-auth-guard')).toContainElement(screen.getByText('Mobile nav'));
  });
});
