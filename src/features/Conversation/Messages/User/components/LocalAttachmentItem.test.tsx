import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LocalAttachmentItem from './LocalAttachmentItem';

const actions = vi.hoisted(() => ({
  status: vi.fn(),
  preview: vi.fn(),
  add: vi.fn(),
  open: vi.fn(),
  warning: vi.fn(),
  vision: true,
}));
vi.mock('@/components/AntdStaticMethods', () => ({ message: { warning: actions.warning } }));
vi.mock('@/hooks/useVisualMediaUploadAbility', () => ({
  useVisualMediaUploadAbility: () => ({ canUploadImage: actions.vision, canUploadVideo: true }),
}));
vi.mock('../../../store', () => ({
  useConversationStore: (selector: any) => selector({ context: { agentId: 'agent' } }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) =>
    selector({ agentMap: { agent: { model: 'selected', provider: 'openai' } } }),
}));
vi.mock('@/services/electron/localAttachmentService', () => ({
  localAttachmentStatus: actions.status,
  previewLocalAttachment: actions.preview,
}));
vi.mock('@/store/file', () => ({
  useFileStore: (selector: any) => selector({ addLocalAttachmentToInput: actions.add }),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) => selector({ openLocalFile: actions.open }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/FileIcon', () => ({ default: () => <span>file</span> }));
vi.mock('./ImageFileListViewer', () => ({
  default: ({ items }: any) => <span>{items[0].url}</span>,
}));
vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: any) => <div>{children}</div>,
  Flexbox: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
const attachment = {
  source: 'local' as const,
  attachmentId: 'a',
  localResourceId: 'r',
  deviceId: 'd',
  version: 'v',
  name: 'image.png',
  mime: 'image/png',
  size: 10,
};
beforeEach(() => {
  vi.clearAllMocks();
  actions.vision = true;
  actions.status.mockResolvedValue(true);
  actions.add.mockResolvedValue(undefined);
});

describe('local attachment message actions', () => {
  it('checks metadata only on mount, then previews and reuses through explicit actions', async () => {
    actions.preview.mockResolvedValue({ dataUrl: 'data:image/png;base64,AQID' });
    render(<LocalAttachmentItem attachment={attachment} messageId="message" topicId="topic" />);
    await waitFor(() => expect(screen.getByText('localAttachment.preview')).not.toBeDisabled());
    expect(actions.preview).not.toHaveBeenCalled();
    expect(actions.add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('localAttachment.preview'));
    await screen.findByText('data:image/png;base64,AQID');
    fireEvent.click(screen.getByText('localAttachment.addToInput'));
    await waitFor(() =>
      expect(actions.add).toHaveBeenCalledWith(
        attachment,
        'message',
        'topic',
        'data:image/png;base64,AQID',
        'main_agent_new',
      ),
    );
  });

  it('blocks image reuse after a model switch while preserving normal preview', async () => {
    actions.preview.mockResolvedValue({ dataUrl: 'preview-image' });
    const view = render(
      <LocalAttachmentItem attachment={attachment} messageId="message" topicId="topic" />,
    );
    await waitFor(() => expect(screen.getByText('localAttachment.addToInput')).not.toBeDisabled());
    actions.vision = false;
    view.rerender(
      <LocalAttachmentItem attachment={{ ...attachment }} messageId="message" topicId="topic" />,
    );
    await waitFor(() => expect(screen.getByText('localAttachment.addToInput')).not.toBeDisabled());
    fireEvent.click(screen.getByText('localAttachment.addToInput'));
    expect(actions.add).not.toHaveBeenCalled();
    expect(actions.warning).toHaveBeenCalledWith('upload.clientMode.visionNotSupported');
    fireEvent.click(screen.getByText('localAttachment.preview'));
    await screen.findByText('preview-image');
    expect(actions.preview).toHaveBeenCalledTimes(1);
  });

  it('allows document reuse with a nonvision model', async () => {
    actions.vision = false;
    render(
      <LocalAttachmentItem
        attachment={{ ...attachment, mime: 'application/pdf' }}
        messageId="message"
        topicId="topic"
      />,
    );
    await waitFor(() => expect(screen.getByText('localAttachment.addToInput')).not.toBeDisabled());
    fireEvent.click(screen.getByText('localAttachment.addToInput'));
    await waitFor(() => expect(actions.add).toHaveBeenCalledTimes(1));
    expect(actions.warning).not.toHaveBeenCalled();
  });

  it('shows a clear unavailable state and never tries to read an unavailable device', async () => {
    actions.status.mockResolvedValue(false);
    render(<LocalAttachmentItem attachment={attachment} messageId="message" topicId="topic" />);
    await screen.findByText(/localAttachment.unavailable/);
    expect(screen.getByText('localAttachment.preview')).toBeDisabled();
    expect(screen.getByText('localAttachment.addToInput')).toBeDisabled();
    expect(actions.preview).not.toHaveBeenCalled();
  });

  it('opens a validated managed document through local preview rather than the remote workspace API', async () => {
    actions.preview.mockResolvedValue({ path: '/managed/.attachments/resource/report.txt' });
    render(
      <LocalAttachmentItem
        attachment={{ ...attachment, name: 'report.txt', mime: 'text/plain' }}
        messageId="message"
        topicId="topic"
      />,
    );
    await waitFor(() => expect(screen.getByText('localAttachment.preview')).not.toBeDisabled());
    fireEvent.click(screen.getByText('localAttachment.preview'));
    await waitFor(() =>
      expect(actions.open).toHaveBeenCalledWith({
        filePath: '/managed/.attachments/resource/report.txt',
        workingDirectory: '/managed/.attachments/resource',
        allowExternalFilePreview: true,
      }),
    );
    expect(actions.preview).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'd' }),
      'topic',
    );
  });
});
