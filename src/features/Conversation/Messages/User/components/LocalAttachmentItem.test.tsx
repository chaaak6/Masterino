import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LocalAttachmentItem from './LocalAttachmentItem';

const actions = vi.hoisted(() => ({
  status: vi.fn(),
  preview: vi.fn(),
  add: vi.fn(),
  open: vi.fn(),
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
      ),
    );
  });

  it('shows a clear unavailable state and never tries to read an unavailable device', async () => {
    actions.status.mockResolvedValue(false);
    render(<LocalAttachmentItem attachment={attachment} messageId="message" topicId="topic" />);
    await screen.findByText(/localAttachment.unavailable/);
    expect(screen.getByText('localAttachment.preview')).toBeDisabled();
    expect(screen.getByText('localAttachment.addToInput')).toBeDisabled();
    expect(actions.preview).not.toHaveBeenCalled();
  });
});
