/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMenu } from './useMenu';

const mocks = vi.hoisted(() => ({
  documentService: {
    getDocumentById: vi.fn(),
  },
  editor: undefined as
    | undefined
    | {
        getDocument: ReturnType<typeof vi.fn>;
      },
  exportFile: vi.fn(),
  message: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@lobechat/builtin-tool-agent-documents', () => ({
  buildAgentDocumentUrl: vi.fn(() => 'https://example.com/document'),
}));

vi.mock('@lobechat/const', () => ({
  isDesktop: false,
}));

vi.mock('@lobechat/utils/client', () => ({
  exportFile: mocks.exportFile,
}));

vi.mock('@lobehub/editor/react', () => ({
  useEditor: () => mocks.editor,
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: vi.fn(),
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ message: mocks.message }),
  },
}));

vi.mock('antd-style', () => ({
  cssVar: {
    colorTextTertiary: 'colorTextTertiary',
  },
  useResponsive: () => ({ lg: true }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => 'workspace',
}));

vi.mock('@/hooks/useAppOrigin', () => ({
  useAppOrigin: () => 'https://example.com',
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    removeDocument: vi.fn(),
  },
}));

vi.mock('@/services/document', () => ({
  documentService: mocks.documentService,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      toggleWideScreen: vi.fn(),
      wideScreen: false,
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    wideScreen: (state: { wideScreen: boolean }) => state.wideScreen,
  },
}));

const getExportHandler = (isHtmlDocument = false) => {
  const { result } = renderHook(() =>
    useMenu({
      agentDocumentId: 'agent-document-1',
      agentId: 'agent-1',
      documentId: 'document-1',
      filename: isHtmlDocument ? 'report.html' : 'report.md',
      isHtmlDocument,
      onDeleted: vi.fn(),
      title: 'Report',
    }),
  );

  const exportMenu = result.current.menuItems.find(
    (item) => item && 'key' in item && item.key === 'export',
  );
  const exportMarkdown =
    exportMenu && 'children' in exportMenu
      ? exportMenu.children?.find((item) => item && 'key' in item && item.key === 'export-markdown')
      : undefined;

  if (!exportMarkdown || !('onClick' in exportMarkdown) || !exportMarkdown.onClick) {
    throw new Error('Export handler not found');
  }

  return () => exportMarkdown.onClick?.({} as never);
};

describe('AgentDocumentPage header export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.editor = {
      getDocument: vi.fn(() => '# Live content'),
    };
  });

  it('exports live editor markdown when serialization succeeds', async () => {
    const onExport = getExportHandler();

    await act(async () => {
      await onExport();
    });

    expect(mocks.exportFile).toHaveBeenCalledWith('# Live content', 'Report.md');
    expect(mocks.documentService.getDocumentById).not.toHaveBeenCalled();
    expect(mocks.message.success).toHaveBeenCalledWith('pageEditor.exportSuccess');
  });

  it('falls back to persisted markdown when live serialization fails', async () => {
    const serializationError = new Error('Editor is not initialized');
    mocks.editor = {
      getDocument: vi.fn(() => {
        throw serializationError;
      }),
    };
    mocks.documentService.getDocumentById.mockResolvedValue({ content: '# Persisted content' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onExport = getExportHandler();

    await act(async () => {
      await onExport();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to export live agent document markdown, falling back to persisted content:',
      serializationError,
    );
    expect(mocks.documentService.getDocumentById).toHaveBeenCalledWith('document-1');
    expect(mocks.exportFile).toHaveBeenCalledWith('# Persisted content', 'Report.md');
    expect(mocks.message.success).toHaveBeenCalledWith('pageEditor.exportSuccess');
  });

  it('falls back to persisted markdown while the live editor is unavailable', async () => {
    mocks.editor = undefined;
    mocks.documentService.getDocumentById.mockResolvedValue({ content: '# Persisted content' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onExport = getExportHandler();

    await act(async () => {
      await onExport();
    });

    expect(mocks.exportFile).toHaveBeenCalledWith('# Persisted content', 'Report.md');
  });

  it('reports an error when both live and persisted markdown are unavailable', async () => {
    const persistenceError = new Error('Request failed');
    mocks.editor = {
      getDocument: vi.fn(() => {
        throw new Error('Editor failed');
      }),
    };
    mocks.documentService.getDocumentById.mockRejectedValue(persistenceError);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onExport = getExportHandler();

    await act(async () => {
      await onExport();
    });

    expect(mocks.exportFile).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Failed to export agent document:', persistenceError);
    expect(mocks.message.error).toHaveBeenCalledWith('pageEditor.exportError');
  });

  it('keeps HTML export on the persisted raw-content path', async () => {
    const html = '<!doctype html><html><body>Report</body></html>';
    mocks.documentService.getDocumentById.mockResolvedValue({ content: html });
    const onExport = getExportHandler(true);

    await act(async () => {
      await onExport();
    });

    expect(mocks.editor?.getDocument).not.toHaveBeenCalled();
    expect(mocks.exportFile).toHaveBeenCalledWith(html, 'report.html');
    expect(mocks.message.success).toHaveBeenCalledWith('pageEditor.exportSuccess');
  });
});
