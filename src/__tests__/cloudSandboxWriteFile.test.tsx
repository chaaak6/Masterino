import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WriteFile from '../../packages/builtin-tool-cloud-sandbox/src/client/Render/WriteFile';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
    <button title={title} onClick={onClick} />
  ),
  Block: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  copyToClipboard: mocks.copyToClipboard,
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Highlighter: ({ children }: { children?: React.ReactNode }) => <pre>{children}</pre>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.split('.').pop() }),
}));

vi.mock('@/components/HtmlPreview', () => ({
  HtmlPreviewDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="html-preview">preview</div> : null,
  isHtmlFile: ({ fileName }: { fileName?: string }) => fileName?.endsWith('.html'),
}));

describe('sandbox WriteFile render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('previews, downloads and copies HTML without OSS', () => {
    let downloadedName = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedName = this.download;
    });

    render(
      <WriteFile
        args={{ content: '<h1>ok</h1>', path: '/workspace/report.html' }}
        content={undefined}
        messageId="message-1"
      />,
    );

    fireEvent.click(screen.getByTitle('preview'));
    expect(screen.getByTestId('html-preview')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('download'));
    expect(downloadedName).toBe('report.html');

    fireEvent.click(screen.getByTitle('copyContent'));
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('<h1>ok</h1>');
  });
});
