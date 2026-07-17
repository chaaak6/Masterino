import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HtmlDocumentPreview from './HtmlDocumentPreview';

const mockSWRState = vi.hoisted(() => ({
  current: {
    data: undefined as { content?: string } | undefined,
    error: undefined as Error | undefined,
    isLoading: false,
  },
}));

vi.mock('@lobehub/ui', () => ({
  Alert: ({ message }: { message: ReactNode }) => <div>{message}</div>,
  Center: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Empty: ({ description }: { description: ReactNode }) => <div>{description}</div>,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Skeleton: () => <div data-testid="loading" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/HtmlPreview', () => ({
  InlineHtmlPreview: ({ content }: { content: string }) => (
    <pre data-testid="inline-html-preview">{content}</pre>
  ),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => mockSWRState.current,
}));

vi.mock('@/services/document', () => ({
  documentService: { getDocumentById: vi.fn() },
}));

vi.mock('@/services/document/swrKeys', () => ({
  documentSWRKeys: { editor: (id: string) => ['document', id] },
}));

describe('HtmlDocumentPreview', () => {
  beforeEach(() => {
    mockSWRState.current = { data: undefined, error: undefined, isLoading: false };
  });

  it('passes the complete raw HTML source to the sandboxed preview', () => {
    const html = '<!doctype html><html><head><title>Report</title></head><body>Body</body></html>';
    mockSWRState.current.data = { content: html };

    render(<HtmlDocumentPreview documentId="document-1" />);

    expect(screen.getByTestId('inline-html-preview')).toHaveTextContent(html);
  });

  it('shows an explicit empty state for an empty HTML document', () => {
    mockSWRState.current.data = { content: '' };

    render(<HtmlDocumentPreview documentId="document-1" />);

    expect(screen.getByText('HtmlPreview.emptyDocument')).toBeInTheDocument();
  });
});
