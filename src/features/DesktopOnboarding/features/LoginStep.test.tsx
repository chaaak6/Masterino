import type { DataSyncConfig } from '@lobechat/electron-client-ipc';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockElectronState = vi.hoisted(() => ({
  clearRemoteServerSyncError: vi.fn(),
  connectRemoteServer: vi.fn(),
  dataSyncConfig: { active: true, storageMode: 'cloud' } as DataSyncConfig,
  isConnectingServer: false,
  refreshServerConfig: vi.fn(),
  remoteServerSyncError: undefined as { message?: string } | undefined,
  useDataSyncConfig: vi.fn(() => ({})),
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: vi.fn(),
}));

vi.mock('@/utils/electron/desktopRuntimeConfig', () => ({
  getDesktopCloudServer: () => 'https://masterino.bielcrystal.com',
  getDesktopCloudServerAliases: () => ['https://mlai-test.bielcrystal.com'],
}));

vi.mock('@lobehub/ui', () => {
  const Button = ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  );

  return {
    Alert: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
      <section>
        <h2>{title}</h2>
        <p>{description}</p>
      </section>
    ),
    Button,
    Center: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Icon: () => <span />,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Text: ({ as, children }: { as?: 'p' | 'span'; children: ReactNode }) =>
      as === 'p' ? <p>{children}</p> : <span>{children}</span>,
  };
});

vi.mock('antd', () => ({
  Divider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd-style', () => ({
  cssVar: {
    colorFillSecondary: '#eee',
    colorTextDescription: '#888',
    colorTextSecondary: '#666',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      const translated = (
        {
          'authResult.failed.desc': 'Authorization failed',
          'authResult.failed.title': 'Authorization Failed',
          'authResult.success.desc':
            'Please click the Start button below to continue using Masterino Desktop',
          'authResult.success.title': 'Authorization Successful',
          'back': 'Back',
          'screen5.actions.cancel': 'Cancel',
          'screen5.actions.connectToServer': 'Connect to server',
          'screen5.actions.signInCloud': 'Sign in Cloud',
          'screen5.actions.tryAgain': 'Try again',
          'screen5.description':
            'Sign in to sync Agents, Groups, settings, and Context across all devices.',
          'screen5.methods.selfhost.description': 'Use self-hosted server',
          'screen5.navigation.next': 'Get Started',
          'screen5.selfhost.endpointPlaceholder': 'https://example.com',
          'screen5.title': 'Sign in to sync across devices',
          'screen5.title2': '',
          'screen5.title3': '',
        } as Record<string, string>
      )[key];

      if (translated) return translated;
      if (typeof fallback === 'string') return fallback;
      return fallback?.defaultValue || key;
    },
  }),
}));

vi.mock('@/const/version', () => ({
  isDesktop: true,
}));

vi.mock('@/features/User/UserInfo', () => ({
  default: () => <div>User Info</div>,
}));

vi.mock('@/hooks/useIMECompositionEvent', () => ({
  useIMECompositionEvent: () => ({
    compositionProps: {},
    isComposingRef: { current: false },
  }),
}));

vi.mock('@/services/electron/remoteServer', () => ({
  remoteServerService: {
    cancelAuthorization: vi.fn(),
  },
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: {
    hasLegacyLocalDb: vi.fn().mockResolvedValue(false),
    openExternalLink: vi.fn(),
    showContextMenu: vi.fn(),
  },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: <T,>(selector: (state: typeof mockElectronState) => T) =>
    selector(mockElectronState),
}));

vi.mock('@/utils/electron/autoOidc', () => ({
  setDesktopAutoOidcFirstOpenHandled: vi.fn(),
}));

vi.mock('../components/LobeMessage', () => ({
  default: ({ sentences }: { sentences: string[] }) => (
    <div>{sentences.filter(Boolean).join(' ')}</div>
  ),
}));

const renderLoginStep = async () => {
  const { default: LoginStep } = await import('./LoginStep');

  render(<LoginStep onBack={vi.fn()} onNext={vi.fn()} />);
};

beforeEach(() => {
  mockElectronState.clearRemoteServerSyncError.mockClear();
  mockElectronState.connectRemoteServer.mockClear();
  mockElectronState.dataSyncConfig = { active: true, storageMode: 'cloud' };
  mockElectronState.isConnectingServer = false;
  mockElectronState.refreshServerConfig.mockClear();
  mockElectronState.remoteServerSyncError = undefined;
  mockElectronState.useDataSyncConfig.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('Desktop onboarding LoginStep', () => {
  it('renders a focused success state and returns to login methods without duplicate auth UI', async () => {
    await renderLoginStep();

    expect(screen.getByText('Authorization Successful')).toBeInTheDocument();
    expect(screen.getByText('User Info')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeInTheDocument();
    expect(screen.queryByText('OR')).not.toBeInTheDocument();
    expect(screen.queryByText('Use self-hosted server')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.queryByText('Authorization Successful')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in Cloud' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use self-hosted server' })).toBeInTheDocument();
  });

  it('treats the configured Cloud origin as Cloud when entered in the self-hosted field', async () => {
    mockElectronState.dataSyncConfig = { active: false, storageMode: 'cloud' };
    await renderLoginStep();

    fireEvent.click(screen.getByRole('button', { name: 'Use self-hosted server' }));
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'https://masterino.bielcrystal.com/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect to server' }));

    expect(mockElectronState.connectRemoteServer).toHaveBeenCalledWith({ storageMode: 'cloud' });
  });

  it('treats the configured test environment alias as Cloud', async () => {
    mockElectronState.dataSyncConfig = { active: false, storageMode: 'cloud' };
    await renderLoginStep();

    fireEvent.click(screen.getByRole('button', { name: 'Use self-hosted server' }));
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'https://mlai-test.bielcrystal.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect to server' }));

    expect(mockElectronState.connectRemoteServer).toHaveBeenCalledWith({
      remoteServerUrl: 'https://mlai-test.bielcrystal.com',
      storageMode: 'cloud',
    });
  });
});
