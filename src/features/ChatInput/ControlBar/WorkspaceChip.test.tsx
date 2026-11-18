/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceChip from './WorkspaceChip';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  Tag: ({ children, ...props }: { children?: ReactNode }) => <span {...props}>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_target, property) => String(property) }),
  cssVar: new Proxy({}, { get: (_target, property) => String(property) }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./DirIcon', () => ({ default: () => null }));
vi.mock('./WorkspacePicker', () => ({ default: () => null }));

describe('WorkspaceChip', () => {
  it('renders a workspace-group draft as a non-interactive full path', () => {
    render(
      <WorkspaceChip
        effective={
          {
            cwd: '/projects/acme',
            isDraft: true,
            state: 'bound',
            workspace: {
              deviceId: 'device-1',
              displayName: 'Acme workspace',
              kind: 'device',
              rootPath: '/projects/acme',
            },
          } as any
        }
      />,
    );

    expect(screen.getByTestId('workspace-chip')).toHaveTextContent('/projects/acme');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps an existing project path display-only', () => {
    render(
      <WorkspaceChip
        effective={
          {
            cwd: '/projects/acme',
            isDraft: false,
            state: 'bound',
            topicId: 'topic-1',
            workspace: {
              deviceId: 'device-1',
              displayName: 'Acme',
              id: 'workspace-1',
              kind: 'device',
              rootPath: '/projects/acme',
            },
          } as any
        }
      />,
    );

    expect(screen.getByTestId('workspace-chip')).toHaveTextContent('/projects/acme');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
