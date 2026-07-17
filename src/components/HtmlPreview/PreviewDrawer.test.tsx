import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HtmlPreviewDrawer from './PreviewDrawer';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  exportFile: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
}));

vi.mock('@lobechat/desktop-bridge', () => ({ TITLE_BAR_HEIGHT: 32 }));

vi.mock('@lobechat/utils/client', () => ({ exportFile: mocks.exportFile }));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Highlighter: ({ children }: { children: ReactNode }) => <pre>{children}</pre>,
  HtmlPreview: ({ children }: { children: ReactNode }) => <iframe srcDoc={String(children)} />,
  Segmented: ({
    onChange,
    options,
  }: {
    onChange: (value: string) => void;
    options: Array<{ label: ReactNode; value: string }>;
  }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { error: mocks.messageError, success: mocks.messageSuccess },
    }),
  },
  Drawer: ({ children, open, title }: { children: ReactNode; open: boolean; title: ReactNode }) =>
    open ? (
      <div>
        <header>{title}</header>
        {children}
      </div>
    ) : null,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ container: 'container' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'HtmlPreview.actions.copy': 'Copy',
        'HtmlPreview.actions.copyFailed': 'Copy failed',
        'HtmlPreview.actions.copySuccess': 'Copied',
        'HtmlPreview.actions.download': 'Download',
        'HtmlPreview.mode.code': 'Code',
        'HtmlPreview.mode.preview': 'Preview',
        'HtmlPreview.title': 'HTML Preview',
      })[key] || key,
  }),
}));

describe('HtmlPreviewDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copyToClipboard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('copies the complete HTML source in preview and code modes', async () => {
    const content = '<!doctype html><html><body><strong>Hello</strong></body></html>';
    render(<HtmlPreviewDrawer open content={content} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledWith(content));

    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledTimes(2));
    expect(mocks.copyToClipboard).toHaveBeenLastCalledWith(content);
    expect(mocks.messageSuccess).toHaveBeenCalledTimes(2);
  });

  it('shows an error when copying fails', async () => {
    const error = new Error('Clipboard unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.copyToClipboard.mockRejectedValueOnce(error);

    render(<HtmlPreviewDrawer open content={'<p>Hello</p>'} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(mocks.messageError).toHaveBeenCalledWith('Copy failed'));
    expect(mocks.messageSuccess).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('Failed to copy HTML preview content:', error);
    consoleError.mockRestore();
  });

  it('downloads the complete HTML using a sanitized document title', () => {
    const content = '<html><head><title>Quarterly / Report</title></head><body>Data</body></html>';
    render(<HtmlPreviewDrawer open content={content} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(mocks.exportFile).toHaveBeenCalledWith(content, 'Quarterly - Report.html');
  });

  it('uses a timestamped filename when the document has no title', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
    const content = '<html><body>Untitled</body></html>';
    render(<HtmlPreviewDrawer open content={content} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(mocks.exportFile).toHaveBeenCalledWith(content, `chat-html-preview-${Date.now()}.html`);
  });
});
