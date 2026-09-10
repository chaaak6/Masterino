/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectWorkspaceStore } from '@/store/projectWorkspace';

import PathConsent, {
  parseStructuredPathConsentRequest,
  type PathConsentDecisionCallback,
  type StructuredPathConsentRequest,
} from './PathConsent';
import { PathConsentResolutionError } from './pathConsentDecision';

vi.mock('@lobehub/ui', () => ({
  Alert: ({
    title,
    description,
    showIcon: _showIcon,
    type: _type,
    ...props
  }: {
    description?: ReactNode;
    showIcon?: boolean;
    title?: ReactNode;
    type?: string;
  }) => (
    <div {...props} role="alert">
      {title}
      {description}
    </div>
  ),
  Flexbox: ({
    children,
    horizontal: _horizontal,
    paddingInline: _paddingInline,
    ...props
  }: {
    children?: ReactNode;
    horizontal?: boolean;
    paddingInline?: number;
  }) => <div {...props}>{children}</div>,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    danger: _danger,
    loading,
    ...props
  }: {
    children?: ReactNode;
    danger?: boolean;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <button {...props} disabled={loading || props.disabled} type="button">
      {children}
    </button>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () =>
    new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      },
    ),
  cssVar: new Proxy(
    {},
    {
      get: (_target, key) => String(key),
    },
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const request: StructuredPathConsentRequest = {
  actualCwd: '/work/app',
  deviceId: 'device-1',
  modes: ['read', 'write', 'exec'],
  operationId: 'operation-1',
  primaryCwd: '/work/app',
  requestedPath: '/data/reports',
  topicId: 'topic-1',
  version: 1,
  warnings: [{ code: 'MODEL_CWD_OVERRIDDEN', overridden: true }],
};

describe('structured workspace path consent', () => {
  beforeEach(() => {
    useProjectWorkspaceStore.setState({ operationConsentByMessage: {} });
  });

  it('rejects missing or unversioned metadata instead of parsing tool arguments', () => {
    expect(parseStructuredPathConsentRequest(undefined)).toBeUndefined();
    expect(
      parseStructuredPathConsentRequest({ requestedPath: '/from/model/args' }),
    ).toBeUndefined();
    expect(parseStructuredPathConsentRequest({ ...request, version: 2 })).toBeUndefined();
  });

  it('keeps an unbound topic consent request valid without inventing a cwd', () => {
    expect(
      parseStructuredPathConsentRequest({ ...request, actualCwd: '', primaryCwd: '' }),
    ).toMatchObject({ actualCwd: '', primaryCwd: '', requestedPath: '/data/reports' });
  });

  it('shows primary/actual cwd, requested path, modes, override, and OS-isolation risk', () => {
    render(<PathConsent messageId="message-1" request={request} />);

    expect(screen.getAllByText('/work/app', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getByText('/data/reports')).toBeInTheDocument();
    expect(screen.getByText('workspacePathConsent.mode.read')).toBeInTheDocument();
    expect(screen.getByText('workspacePathConsent.mode.write')).toBeInTheDocument();
    expect(screen.getByText('workspacePathConsent.mode.exec')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-path-consent-cwd-override')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-path-consent-risk')).toHaveTextContent(
      'workspacePathConsent.notOsSandbox',
    );
    expect(screen.getByTestId('workspace-path-consent-risk')).toHaveTextContent(
      'workspacePathConsent.notOsSandboxDescription',
    );
  });

  it.each([
    ['workspacePathConsent.once', 'operation'],
    ['workspacePathConsent.topic', 'topic'],
    ['workspacePathConsent.reject', 'reject'],
  ] as const)(
    'records %s through the typed callback seam without claiming success',
    async (label, scope) => {
      const onDecision = vi.fn<PathConsentDecisionCallback>();
      render(<PathConsent messageId="message-1" request={request} onDecision={onDecision} />);

      fireEvent.click(screen.getByRole('button', { name: label }));

      await waitFor(() => expect(onDecision).toHaveBeenCalledTimes(1));
      expect(onDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          actualCwd: '/work/app',
          deviceId: 'device-1',
          modes: ['read', 'write', 'exec'],
          operationId: 'operation-1',
          primaryCwd: '/work/app',
          requestedPath: '/data/reports',
          rootPath: '/data/reports',
          scope,
          topicId: 'topic-1',
        }),
      );
      expect(
        useProjectWorkspaceStore.getState().operationConsentByMessage['message-1'],
      ).toMatchObject({
        scope,
      });
      expect(screen.getByTestId('workspace-path-consent-recorded')).toHaveTextContent(
        scope === 'reject'
          ? 'workspacePathConsent.rejectRecorded'
          : 'workspacePathConsent.recordedNotResumed',
      );
    },
  );

  it('stores the canonical decision and confirms resume only after coordination completes', async () => {
    const onDecision = vi.fn<PathConsentDecisionCallback>(async (decision) => ({
      ...decision,
      rootPath: '/canonical/reports',
    }));
    render(<PathConsent messageId="message-1" request={request} onDecision={onDecision} />);

    fireEvent.click(screen.getByRole('button', { name: 'workspacePathConsent.once' }));

    await waitFor(() =>
      expect(screen.getByTestId('workspace-path-consent-recorded')).toHaveTextContent(
        'workspacePathConsent.approvedAndResumed',
      ),
    );
    expect(
      useProjectWorkspaceStore.getState().operationConsentByMessage['message-1'],
    ).toMatchObject({ rootPath: '/canonical/reports', scope: 'operation' });
  });

  it.each([
    ['workspacePathConsent.once', 'operation'],
    ['workspacePathConsent.topic', 'topic'],
  ] as const)(
    'shows an actionable missing-path error for %s without recording consent',
    async (label, _scope) => {
      const onDecision = vi.fn<PathConsentDecisionCallback>(async () => {
        throw new PathConsentResolutionError('PATH_NOT_FOUND');
      });
      render(<PathConsent messageId="message-1" request={request} onDecision={onDecision} />);

      fireEvent.click(screen.getByRole('button', { name: label }));

      await waitFor(() =>
        expect(
          screen
            .getAllByRole('alert')
            .some((alert) => alert.textContent?.includes('workspacePathConsent.pathNotFound')),
        ).toBe(true),
      );
      expect(
        useProjectWorkspaceStore.getState().operationConsentByMessage['message-1'],
      ).toBeUndefined();
      expect(screen.queryByTestId('workspace-path-consent-recorded')).not.toBeInTheDocument();
    },
  );

  it('keeps every choice keyboard-addressable and exposes a labelled group', () => {
    render(<PathConsent messageId="message-1" request={request} />);

    expect(screen.getByRole('group', { name: 'workspacePathConsent.actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    for (const button of screen.getAllByRole('button'))
      expect(button).not.toHaveAttribute('tabindex', '-1');
  });
});
