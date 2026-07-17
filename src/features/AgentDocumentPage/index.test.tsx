import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentDocumentPage from './index';

const mockDocumentItem = vi.hoisted(() => ({
  current: {
    isLoading: false,
    item: undefined as
      | {
          documentId: string;
          fileType: string;
          filename: string;
          id: string;
          title: string;
        }
      | undefined,
  },
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Skeleton: () => <div data-testid="loading" />,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ aid: 'agent-1' }),
}));

vi.mock('@/features/PageEditor', () => ({
  PageEditor: ({ content }: { content?: ReactNode }) => (
    <div data-custom-content={content ? 'true' : 'false'} data-testid="page-editor">
      {content}
    </div>
  ),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('./Header', () => ({
  default: () => <div data-testid="header" />,
}));

vi.mock('./HtmlDocumentPreview', () => ({
  default: () => <div data-testid="html-document-preview" />,
}));

vi.mock('./useAgentDocumentItem', () => ({
  useAgentDocumentItem: () => ({
    isLoading: mockDocumentItem.current.isLoading,
    item: mockDocumentItem.current.item,
    mutate: vi.fn(),
  }),
}));

describe('AgentDocumentPage document renderer', () => {
  beforeEach(() => {
    mockDocumentItem.current = {
      isLoading: false,
      item: undefined,
    };
  });

  it('uses the sandboxed HTML preview for HTML documents', () => {
    mockDocumentItem.current.item = {
      documentId: 'document-1',
      fileType: 'agent/document',
      filename: 'report.html',
      id: 'agent-document-1',
      title: 'Report',
    };

    render(<AgentDocumentPage documentId="document-1" />);

    expect(screen.getByTestId('html-document-preview')).toBeInTheDocument();
    expect(screen.getByTestId('page-editor')).toHaveAttribute('data-custom-content', 'true');
  });

  it('keeps non-HTML documents on the existing page editor path', () => {
    mockDocumentItem.current.item = {
      documentId: 'document-1',
      fileType: 'agent/document',
      filename: 'notes.md',
      id: 'agent-document-1',
      title: 'Notes',
    };

    render(<AgentDocumentPage documentId="document-1" />);

    expect(screen.queryByTestId('html-document-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-editor')).toHaveAttribute('data-custom-content', 'false');
  });
});
