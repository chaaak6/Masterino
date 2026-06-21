import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui', () => ({
  ContextMenuHost: () => null,
  ModalHost: () => null,
  TooltipGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ModalHost: () => null,
  ToastHost: () => null,
}));

vi.mock('antd-style', () => ({
  StyleProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('motion/react', () => ({
  LazyMotion: ({ children }: { children: ReactNode }) => <>{children}</>,
  domMax: {},
}));

vi.mock('@/components/Analytics/LobeAnalyticsProviderWrapper', () => ({
  LobeAnalyticsProviderWrapper: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/DragUploadZone/DragUploadProvider', () => ({
  DragUploadProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/const/version', () => ({
  isDesktop: false,
}));

vi.mock('@/features/AgentMockDevtools', () => ({
  default: () => null,
}));

vi.mock('@/features/DevFeatureFlagPanel', () => ({
  default: () => null,
}));

vi.mock('@/layout/AuthProvider', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/layout/GlobalProvider/AppTheme', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/layout/GlobalProvider/CacheHydrationGate', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/layout/GlobalProvider/DynamicFavicon', () => ({
  default: () => null,
}));

vi.mock('@/layout/GlobalProvider/FaviconProvider', () => ({
  FaviconProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/layout/GlobalProvider/GroupWizardProvider', () => ({
  GroupWizardProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/layout/GlobalProvider/Query', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/layout/GlobalProvider/ServerVersionOutdatedAlert', () => ({
  default: () => null,
}));

vi.mock('@/layout/GlobalProvider/StoreInitialization', () => ({
  default: () => null,
}));

vi.mock('@/store/serverConfig/Provider', () => ({
  ServerConfigStoreProvider: ({
    children,
    isMobile,
  }: {
    children: ReactNode;
    isMobile?: boolean;
  }) => (
    <div data-is-mobile={String(Boolean(isMobile))} data-testid="server-config-provider">
      {children}
    </div>
  ),
}));

vi.mock('./Locale', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('SPAGlobalProvider', () => {
  afterEach(() => {
    window.__SERVER_CONFIG__ = undefined;
  });

  it('uses serverConfig.isMobile when the served SPA variant is mobile', async () => {
    window.__SERVER_CONFIG__ = {
      analyticsConfig: {},
      clientEnv: {},
      config: {},
      featureFlags: {},
      isMobile: true,
    } as any;

    const { default: SPAGlobalProvider } = await import('.');

    render(
      <SPAGlobalProvider>
        <span>child</span>
      </SPAGlobalProvider>,
    );

    expect(screen.getByTestId('server-config-provider')).toHaveAttribute(
      'data-is-mobile',
      'true',
    );
  });
});
