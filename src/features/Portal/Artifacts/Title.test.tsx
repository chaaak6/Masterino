import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtifactDisplayMode } from '@/store/chat/slices/portal/initialState';

import Title from './Title';

const mocks = vi.hoisted(() => ({
  activeAgentId: 'agent-1' as string | undefined,
  artifactContent: '<html><head><title>Artifact</title></head><body>Hello</body></html>',
  artifactIdentifier: 'artifact-id',
  artifactMessageId: 'message-1',
  artifactTitle: 'Artifact title',
  artifactType: 'text/html' as string | undefined,
  closeArtifact: vi.fn(),
  copyToClipboard: vi.fn(),
  displayMode: 'preview',
  exportFile: vi.fn(),
  isArtifactTagClosed: true,
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  setState: vi.fn(),
  writeByPath: vi.fn(),
}));

vi.mock('@lobechat/utils/client', () => ({ exportFile: mocks.exportFile }));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick }: { onClick: () => void }) => <button onClick={onClick}>Back</button>,
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
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
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { error: mocks.messageError, success: mocks.messageSuccess },
    }),
  },
  ConfigProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('antd-style', () => ({ cx: (...values: string[]) => values.join(' ') }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'HtmlPreview.actions.copy': 'Copy',
        'HtmlPreview.actions.copyFailed': 'Copy failed',
        'HtmlPreview.actions.copySuccess': 'Copied',
        'HtmlPreview.actions.download': 'Download',
        'artifacts.display.code': 'Code',
        'artifacts.display.preview': 'Preview',
        'artifacts.persistence.failed': 'Save failed',
      })[key] || key,
  }),
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: { writeByPath: mocks.writeByPath },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: Record<PropertyKey, unknown>) => unknown) =>
      selector({
        activeAgentId: mocks.activeAgentId,
        closeArtifact: mocks.closeArtifact,
        portalArtifactDisplayMode: mocks.displayMode,
      }),
    { setState: mocks.setState },
  ),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    artifactCode: () => () => mocks.artifactContent,
    artifactIdentifier: () => mocks.artifactIdentifier,
    artifactMessageId: () => mocks.artifactMessageId,
    artifactTitle: () => mocks.artifactTitle,
    artifactType: () => mocks.artifactType,
    isArtifactTagClosed: () => () => mocks.isArtifactTagClosed,
  },
}));

vi.mock('@/styles', () => ({ oneLineEllipsis: 'ellipsis' }));

describe('Artifacts title', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeAgentId = 'agent-1';
    mocks.artifactContent = '<html><head><title>Artifact</title></head><body>Hello</body></html>';
    mocks.artifactIdentifier = 'artifact-id';
    mocks.artifactMessageId = 'message-1';
    mocks.artifactTitle = 'Artifact title';
    mocks.artifactType = 'text/html';
    mocks.displayMode = ArtifactDisplayMode.Preview;
    mocks.isArtifactTagClosed = true;
    mocks.copyToClipboard.mockResolvedValue(undefined);
    mocks.writeByPath.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([ArtifactDisplayMode.Preview, ArtifactDisplayMode.Code])(
    'copies the complete HTML source in %s mode',
    async (displayMode) => {
      mocks.displayMode = displayMode;
      render(<Title />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      await waitFor(() =>
        expect(mocks.copyToClipboard).toHaveBeenCalledWith(mocks.artifactContent),
      );
      expect(mocks.messageSuccess).toHaveBeenCalledWith('Copied');
    },
  );

  it('shows an explicit error when copying fails', async () => {
    const error = new Error('Clipboard unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.copyToClipboard.mockRejectedValueOnce(error);
    render(<Title />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(mocks.messageError).toHaveBeenCalledWith('Copy failed'));
    expect(consoleError).toHaveBeenCalledWith('Failed to copy HTML artifact content:', error);
    consoleError.mockRestore();
  });

  it('downloads the complete HTML using a sanitized document title', () => {
    mocks.artifactContent =
      '<html><head><title>Quarterly / Report</title></head><body>Data</body></html>';
    render(<Title />);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(mocks.exportFile).toHaveBeenCalledWith(mocks.artifactContent, 'Quarterly - Report.html');
  });

  it('uses a timestamped download name when the HTML has no title', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
    mocks.artifactContent = '<html><body>Untitled</body></html>';
    render(<Title />);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(mocks.exportFile).toHaveBeenCalledWith(
      mocks.artifactContent,
      `chat-html-preview-${Date.now()}.html`,
    );
  });

  it('upserts finalized HTML into Space documents', async () => {
    mocks.artifactContent =
      '<html><head><title>Quarterly / Report</title></head><body>Data</body></html>';
    render(<Title />);

    await waitFor(() =>
      expect(mocks.writeByPath).toHaveBeenCalledWith({
        agentId: 'agent-1',
        content: mocks.artifactContent,
        createMode: 'if-missing',
        path: './Quarterly - Report.html',
      }),
    );
  });

  it('shows an explicit error when saving to Space fails', async () => {
    const error = new Error('Storage unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.writeByPath.mockRejectedValueOnce(error);
    render(<Title />);

    await waitFor(() => expect(mocks.messageError).toHaveBeenCalledWith('Save failed'));
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to persist HTML artifact to agent documents:',
      error,
    );
    consoleError.mockRestore();
  });

  it('does not expose actions or persist while the artifact is streaming', () => {
    mocks.isArtifactTagClosed = false;
    render(<Title />);

    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(mocks.writeByPath).not.toHaveBeenCalled();
  });
});
