import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ExportFile from '../../packages/builtin-tool-cloud-sandbox/src/client/Render/ExportFile';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  openFilePreview: vi.fn(),
  reInvokeToolMessage: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
    <button title={title} onClick={onClick} />
  ),
  copyToClipboard: mocks.copyToClipboard,
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ container: 'container', statusIcon: 'statusIcon' }),
  cssVar: { colorError: 'red', colorSuccess: 'green' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      key === 'builtins.lobe-cloud-sandbox.export.success'
        ? `Exported: ${values?.filename}`
        : key === 'builtins.lobe-cloud-sandbox.export.failed'
          ? `Failed to export ${values?.path}`
          : key.split('.').pop(),
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: any) => unknown) =>
    selector({
      openFilePreview: mocks.openFilePreview,
      reInvokeToolMessage: mocks.reInvokeToolMessage,
    }),
}));

describe('sandbox ExportFile render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('previews, downloads and copies a stable exported file link', async () => {
    let clickedHref = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedHref = this.href;
    });

    render(
      <ExportFile
        args={{ path: '/workspace/report.html' }}
        content={undefined}
        messageId="message-1"
        pluginState={{
          downloadUrl: '/f/file-1',
          fileId: 'file-1',
          filename: 'report.html',
          path: '/workspace/report.html',
          success: true,
        }}
      />,
    );

    fireEvent.click(screen.getByTitle('preview'));
    expect(mocks.openFilePreview).toHaveBeenCalledWith({ fileId: 'file-1' });

    fireEvent.click(screen.getByTitle('download'));
    expect(clickedHref).toBe('http://localhost:3000/f/file-1?download=1');

    fireEvent.click(screen.getByTitle('copyLink'));
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('http://localhost:3000/f/file-1?download=1');
  });

  it('shows the structured error and retries the existing tool message', async () => {
    render(
      <ExportFile
        args={{ path: '/workspace/report.html' }}
        content={undefined}
        messageId="message-2"
        pluginState={{
          downloadUrl: '',
          error: {
            code: 'WORKER_UPLOAD_FAILED',
            message: 'OSS connection timed out',
            retryable: true,
            stage: 'upload',
          },
          filename: 'report.html',
          path: '/workspace/report.html',
          success: false,
        }}
      />,
    );

    expect(screen.getByText('OSS connection timed out')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('retry'));
    expect(mocks.reInvokeToolMessage).toHaveBeenCalledWith('message-2');
  });
});
