import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceMarkdown from './WorkspaceMarkdown';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/services/projectFile', () => ({
  projectFileService: {
    getLocalFilePreview: vi.fn(async () => ({
      blob: new Blob(['image'], { type: 'image/svg+xml' }),
      contentType: 'image/svg+xml',
      type: 'image',
    })),
  },
}));

const show = (content: string, onOpenFile = vi.fn()) =>
  render(
    <WorkspaceMarkdown
      content={content}
      deviceId={'test-device'}
      filePath={'/workspace/docs/README.md'}
      workingDirectory={'/workspace'}
      onOpenFile={onOpenFile}
    />,
  );

describe('Workspace Markdown preview', () => {
  it('renders all GitHub callouts and keeps both paragraphs and inline markup', () => {
    const { container } = show(
      [
        '> [!NOTE] **First line**\n>\n> Second paragraph.',
        '> [!TIP]\n> Tip.',
        '> [!IMPORTANT] Plain same-line text.',
        '> [!WARNING]\n> Warning.',
        '> [!CAUTION]\n> Caution.',
        '> Ordinary quotation.',
        '```html\n> [!NOTE]\n<img src="example.svg">\n```',
      ].join('\n\n'),
    );

    const callouts = container.querySelectorAll('.markdown-alert');
    expect(callouts).toHaveLength(5);
    expect(callouts[0].querySelector('strong')).toHaveTextContent('First line');
    expect(callouts[0]).toHaveTextContent('Second paragraph.');
    expect(callouts[2]).toHaveTextContent('Plain same-line text.');
    expect(container.querySelector('blockquote')).toHaveTextContent('Ordinary quotation.');
    expect(container.querySelector('pre')).toHaveTextContent('<img src="example.svg">');
  });

  it('renders Markdown and HTML images and opens the linked media in the source workspace', async () => {
    const open = vi.fn();
    const { container } = show(
      [
        '<img src="assets/banner.svg" alt="HTML banner" width="100%" />',
        '<a href="assets/demo.mp4"><img src="assets/demo.gif" alt="Watch demo" /></a>',
        '![Markdown banner](assets/banner.svg) and [![Inline demo](assets/demo.gif)](assets/demo.mp4)',
      ].join('\n\n'),
      open,
    );

    expect(await screen.findByAltText('HTML banner')).toBeVisible();
    expect(await screen.findByAltText('Markdown banner')).toBeVisible();
    const videoLink = await screen.findByRole('link', { name: 'Watch demo' });
    expect(videoLink.querySelector('img')).toBeVisible();
    expect(container.querySelector('p div')).toBeNull();
    fireEvent.click(videoLink);
    expect(open).toHaveBeenCalledExactlyOnceWith({
      deviceId: 'test-device',
      filePath: '/workspace/docs/assets/demo.mp4',
      workingDirectory: '/workspace',
    });
  });

  it('focuses the matching heading, keeps footnotes navigable and opens other files at a fragment', () => {
    const open = vi.fn();
    const { container } = show(
      [
        '[Jump to second](#安装-1) · [Open guide](../%E6%8C%87%E5%8D%97%20A.md#安装)',
        '## 安装\n\nFirst.',
        '## 安装\n\nSecond.',
        'Annotation[^1]',
        '[^1]: Footnote.',
      ].join('\n\n'),
      open,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Jump to second' }));
    expect(screen.getAllByRole('heading', { name: '安装' })[1]).toHaveFocus();

    fireEvent.click(screen.getByRole('link', { name: 'Open guide' }));
    expect(open).toHaveBeenCalledExactlyOnceWith({
      deviceId: 'test-device',
      filePath: '/workspace/指南 A.md',
      fragment: '安装',
      workingDirectory: '/workspace',
    });
    fireEvent.click(container.querySelector('a[data-footnote-ref]')!);
    expect(document.activeElement).toHaveTextContent('Footnote.');
  });

  it('renders folding and ordinary Markdown while limiting raw HTML and local paths', () => {
    const open = vi.fn();
    const { container } = show(
      [
        '<details open><summary>Show details</summary><p>Body</p></details>',
        '<form><input name="unexpected" /></form>',
        '<a href="/outside.md" style="position: fixed">Absolute link</a>',
        '[Outside](../../outside.md)',
        '[External](https://example.com)',
        '| Feature | Status |\n| --- | --- |\n| Tables | Available |',
        '- [x] Done\n\n~~Removed~~ · $x^2$',
      ].join('\n\n'),
      open,
    );
    expect(screen.getByText('Show details').closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(container.querySelector('del')).toHaveTextContent('Removed');
    expect(container.querySelector('.katex')).toBeTruthy();
    expect(container.querySelector('form, input[name="unexpected"], a[style]')).toBeNull();
    fireEvent.click(screen.getByText('Outside'));
    fireEvent.click(screen.getByText('Absolute link'));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'External' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });
});
