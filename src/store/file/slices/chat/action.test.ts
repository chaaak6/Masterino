import { toast } from '@lobehub/ui/base-ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { notification } from '@/components/AntdStaticMethods';
import * as localAttachments from '@/services/electron/localAttachmentService';
import { ragService } from '@/services/rag';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useFileStore as useStore } from '../../store';
import { sameChatAttachmentDraft } from './drafts';
import { fileChatSelectors } from './selectors';

const AGENT_ID = 'agent-1';

/** Force the conversation agent into chat / agent / heterogeneous mode for the by-id selectors. */
const mockAgentMode = ({
  enableAgentMode,
  heterogeneous,
}: {
  enableAgentMode: boolean;
  heterogeneous: boolean;
}) => {
  vi.spyOn(agentByIdSelectors, 'getAgentEnableModeById').mockReturnValue(() => enableAgentMode);
  vi.spyOn(agentByIdSelectors, 'isAgentHeterogeneousById').mockReturnValue(() => heterogeneous);
};

vi.mock('zustand/traditional');

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: {
    error: vi.fn(),
  },
}));

// Mock necessary modules and functions
vi.mock('@/components/AntdStaticMethods', () => ({
  notification: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/services/rag', () => ({
  ragService: {
    parseFileContent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('i18next', () => ({
  t: (key: string, options?: { reason?: string }) => {
    if (key === 'upload.permissionDenied') {
      return 'You do not have permission to upload files in this workspace.';
    }

    if (key === 'upload.uploadFailed') return 'File upload failed.';

    if (key === 'upload.unknownError') return `Error reason: ${options?.reason}`;

    if (key === 'upload.parseFailed') return 'File analysis failed';

    if (key === 'upload.parseFailedDesc') {
      return 'The file was uploaded, but text analysis failed. This is not an object storage upload failure.';
    }

    return key;
  },
}));

beforeAll(() => {
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    writable: true,
    value: function () {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result);
        };
        reader.readAsArrayBuffer(this);
      });
    },
  });
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('useFileStore:chat', () => {
  it('keeps page selections within their document draft and preserves the legacy input', () => {
    const firstPage = messageMapKey({ agentId: AGENT_ID, documentId: 'first', scope: 'page' });
    const secondPage = messageMapKey({ agentId: AGENT_ID, documentId: 'second', scope: 'page' });
    const home = `home_${messageMapKey({ agentId: AGENT_ID })}`;
    const first = { content: 'First page', id: 'selection', type: 'text' } as const;
    const second = { content: 'Second page', id: 'selection', type: 'text' } as const;
    const legacy = { content: 'Legacy input', id: 'legacy', type: 'text' } as const;
    const { addChatContextSelection, clearChatContextSelections, removeChatContextSelection } =
      useStore.getState();

    addChatContextSelection(legacy);
    addChatContextSelection(first, firstPage);
    const before = useStore.getState();
    addChatContextSelection(second, secondPage);
    const after = useStore.getState();
    expect(sameChatAttachmentDraft(before, after, firstPage)).toBe(true);
    expect(sameChatAttachmentDraft(before, after, secondPage)).toBe(false);
    expect(fileChatSelectors.chatContextSelections(after, firstPage)).toEqual([first]);
    expect(fileChatSelectors.chatContextSelectionHasItem(after, home)).toBe(false);

    clearChatContextSelections(firstPage);
    expect(fileChatSelectors.chatContextSelections(useStore.getState(), secondPage)).toEqual([
      second,
    ]);
    expect(fileChatSelectors.chatContextSelections(useStore.getState())).toEqual([legacy]);
    removeChatContextSelection(second.id, secondPage);
    clearChatContextSelections();
    expect(fileChatSelectors.chatContextSelections(useStore.getState(), secondPage)).toEqual([]);
    expect(fileChatSelectors.chatContextSelections(useStore.getState())).toEqual([]);
  });

  it('clearChatUploadFileList should clear the inputFilesList', () => {
    const { result } = renderHook(() => useStore());

    act(() => {
      useStore.setState({ chatUploadFileList: [{ id: 'abc' }] as any });
    });

    expect(result.current.chatUploadFileList).toEqual([{ id: 'abc' }]);

    act(() => {
      result.current.clearChatUploadFileList();
    });

    expect(result.current.chatUploadFileList).toEqual([]);
  });

  it.each([
    ['image/png', 'data:image/png;base64,AQID'],
    ['application/octet-stream', 'data:image/png;base64,AQID'],
    ['application/octet-stream', undefined],
  ])('restores historical %s with preview %s', async (mime, dataUrl) => {
    const ref = {
      source: 'local' as const,
      attachmentId: 'a',
      localResourceId: 'r',
      deviceId: 'd',
      version: 'v',
      name: 'image.png',
      mime,
      size: 10,
    };
    const status = vi.spyOn(localAttachments, 'localAttachmentStatus').mockResolvedValue(true);
    const bind = vi
      .spyOn(localAttachments, 'bindLocalAttachmentMessage')
      .mockResolvedValue(undefined);
    const retain = vi
      .spyOn(localAttachments, 'retainLocalAttachmentDraft')
      .mockResolvedValue({ available: true });
    const preview = vi
      .spyOn(localAttachments, 'previewLocalAttachment')
      .mockResolvedValue({ dataUrl });
    const release = vi
      .spyOn(localAttachments, 'releaseLocalAttachmentDraft')
      .mockResolvedValue(undefined);
    try {
      const { result } = renderHook(() => useStore());
      act(() => useStore.setState({ chatUploadFileList: [] }));
      await act(async () => result.current.addLocalAttachmentToInput(ref, 'message', 'topic'));
      const item = result.current.chatUploadFileList[0];
      expect(item).toMatchObject({
        attachment: ref,
        id: 'a',
        previewUrl: dataUrl,
        status: 'success',
      });
      expect(item.attachmentDraftId).toBeTruthy();
      expect(item.file).toMatchObject({ size: 0, type: dataUrl ? 'image/png' : mime });
      expect(bind).toHaveBeenCalledWith([{ attachment: ref }], 'message', 'topic');
      await act(async () => result.current.addLocalAttachmentToInput(ref, 'message', 'topic'));
      expect(retain).toHaveBeenCalledTimes(1);
      act(() => result.current.clearChatUploadFileList({ preserveAttachments: true }));
      expect(release).not.toHaveBeenCalled();
      act(() => useStore.setState({ chatUploadFileList: [item] }));
      await act(async () => result.current.removeChatUploadFile('a'));
      expect(release).toHaveBeenCalledWith(ref, item.attachmentDraftId);
      release.mockClear();
      retain.mockImplementationOnce(async () => {
        result.current.clearChatUploadFileList();
        return { available: true };
      });
      await act(async () => result.current.addLocalAttachmentToInput(ref, 'message', 'topic'));
      expect(result.current.chatUploadFileList).toEqual([]);
      expect(release).toHaveBeenCalledWith(ref, expect.any(String));
    } finally {
      [status, bind, retain, preview, release].forEach((spy) => spy.mockRestore());
    }
  });

  it('uploadChatFiles should reject unsupported files before upload in chat mode', async () => {
    // chat mode: agent mode disabled and not a heterogeneous agent
    mockAgentMode({ enableAgentMode: false, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const uploadWithProgress = vi.fn();

    act(() => {
      useStore.setState({
        chatUploadFileList: [],
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    await act(async () => {
      await result.current.uploadChatFiles(
        [
          new File(['<svg />'], 'icon.svg', { type: 'image/svg+xml' }),
          new File(['zip'], 'archive.zip', { type: 'application/zip' }),
        ],
        AGENT_ID,
      );
    });

    expect(uploadWithProgress).not.toHaveBeenCalled();
    expect(result.current.chatUploadFileList).toEqual([]);
    expect(result.current.chatAttachmentIssues).toEqual([
      expect.objectContaining({ reason: 'unsupported-format', name: 'icon.svg' }),
      expect.objectContaining({ reason: 'unsupported-format', name: 'archive.zip' }),
    ]);
  });

  it('uploadChatFiles should allow any file type in agent mode', async () => {
    mockAgentMode({ enableAgentMode: true, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const uploadWithProgress = vi.fn().mockResolvedValue({ id: 'file-1', url: 'http://x/1' });

    act(() => {
      useStore.setState({
        chatUploadFileList: [],
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    await act(async () => {
      await result.current.uploadChatFiles(
        [new File(['zip'], 'archive.zip', { type: 'application/zip' })],
        AGENT_ID,
      );
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
  });

  it('uploadChatFiles should allow any file type for heterogeneous agents', async () => {
    mockAgentMode({ enableAgentMode: false, heterogeneous: true });

    const { result } = renderHook(() => useStore());
    const uploadWithProgress = vi.fn().mockResolvedValue({ id: 'file-2', url: 'http://x/2' });

    act(() => {
      useStore.setState({
        chatUploadFileList: [],
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    await act(async () => {
      await result.current.uploadChatFiles(
        [new File(['profile'], 'Communication_Notifications.provisionprofile')],
        AGENT_ID,
      );
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
  });

  it('reserves image slots before concurrent intakes yield', async () => {
    mockAgentMode({ enableAgentMode: true, heterogeneous: false });
    const upload = vi
      .spyOn(useStore.getState(), 'uploadWithProgress')
      .mockImplementation(async ({ uploadId }) => ({
        id: `server-${uploadId}`,
        url: 'https://example.test/image',
      }));
    const makeImage = (i: number, type = 'image/gif') =>
      new File(['GIF89a'], `image-${i}.gif`, { type });
    const first = useStore.getState().uploadChatFiles(
      Array.from({ length: 9 }, (_, i) => makeImage(i)),
      AGENT_ID,
    );
    const second = useStore.getState().uploadChatFiles([makeImage(9)], AGENT_ID);
    const third = useStore
      .getState()
      .uploadChatFiles([makeImage(10, 'application/octet-stream')], AGENT_ID);
    expect(useStore.getState().chatUploadFileList).toHaveLength(10);
    await Promise.all([first, second, third]);
    expect(upload).toHaveBeenCalledTimes(10);
    expect(useStore.getState().chatAttachmentIssues).toEqual([
      expect.objectContaining({ reason: 'image-count' }),
    ]);
  });

  it('keeps same-name files independent and rejects oversized Web files before upload', async () => {
    mockAgentMode({ enableAgentMode: true, heterogeneous: false });
    const upload = vi
      .spyOn(useStore.getState(), 'uploadWithProgress')
      .mockImplementation(async ({ uploadId }) => ({
        id: `server-${uploadId}`,
        url: 'https://example.test/image',
      }));
    const large = new File([], 'oversized.txt', { type: 'text/plain' });
    Object.defineProperty(large, 'size', { value: 10 * 1024 * 1024 + 1 });
    await useStore
      .getState()
      .uploadChatFiles(
        [
          new File(['GIF89a'], 'same.gif', { type: 'image/gif' }),
          new File(['different'], 'same.gif', { type: 'image/gif' }),
          large,
        ],
        AGENT_ID,
      );
    expect(upload).toHaveBeenCalledTimes(2);
    expect(new Set(useStore.getState().chatUploadFileList.map((item) => item.id)).size).toBe(2);
    expect(useStore.getState().chatAttachmentIssues).toEqual([
      expect.objectContaining({ reason: 'web-size' }),
    ]);
  });

  it('shows a permission denied description when upload is rejected by RBAC', async () => {
    mockAgentMode({ enableAgentMode: false, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const file = new File(['test'], 'test.txt', { type: 'text/plain' });

    vi.spyOn(result.current, 'uploadWithProgress').mockRejectedValue({
      data: { code: 'FORBIDDEN' },
      message: 'Missing any of: file:upload:all, file:upload:owner',
    });

    await act(async () => {
      await result.current.uploadChatFiles([file], AGENT_ID);
    });

    expect(result.current.chatUploadFileList[0]).toMatchObject({
      status: 'error',
      attachmentError: 'permission-denied',
    });
  });

  it('keeps uploaded chat files when parsing or embedding fails after upload', async () => {
    mockAgentMode({ enableAgentMode: false, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const file = new File(['Masterino marker: cobalt-17'], 'note.txt', { type: 'text/plain' });
    const uploadWithProgress = vi.fn().mockResolvedValue({ id: 'file-3', url: 'http://x/3' });

    vi.mocked(ragService.parseFileContent).mockRejectedValue(new Error('embedding model missing'));

    act(() => {
      useStore.setState({
        chatUploadFileList: [],
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    await act(async () => {
      await result.current.uploadChatFiles([file], AGENT_ID);
    });

    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
    expect(ragService.parseFileContent).toHaveBeenCalledWith('file-3');
    expect(result.current.chatUploadFileList).toHaveLength(1);
    expect(result.current.chatUploadFileList[0]).toMatchObject({
      attachmentError: 'parse-failed',
      id: 'file-3',
      processStage: 'content_parse_failed',
      status: 'error',
    });
  });

  it.each(['STORAGE_OBJECT_MISSING', 'STORAGE_OBJECT_UNAVAILABLE'])(
    'reports %s as a storage failure instead of a parse failure',
    async (storageErrorCode) => {
      mockAgentMode({ enableAgentMode: false, heterogeneous: false });

      const { result } = renderHook(() => useStore());
      const file = new File(['Masterino marker: storage-missing'], 'note.txt', {
        type: 'text/plain',
      });
      const uploadWithProgress = vi
        .fn()
        .mockResolvedValue({ id: 'file-missing', url: 'http://x/4' });

      vi.mocked(ragService.parseFileContent).mockRejectedValue(new Error(storageErrorCode));

      act(() => {
        useStore.setState({
          chatUploadFileList: [],
          uploadWithProgress: uploadWithProgress as any,
        });
      });

      await act(async () => {
        await result.current.uploadChatFiles([file], AGENT_ID);
      });

      expect(notification.warning).not.toHaveBeenCalled();
      expect(result.current.chatUploadFileList).toHaveLength(1);
      expect(result.current.chatUploadFileList[0]).toMatchObject({
        diagnostic: {
          fileId: 'file-missing',
          message: storageErrorCode,
          stage: 'storage_upload_failed',
        },
        attachmentError: 'upload-failed',
        id: 'file-missing',
        processStage: 'storage_upload_failed',
        status: 'error',
      });
    },
  );

  it('keeps non-media chat files processing until content parsing finishes', async () => {
    mockAgentMode({ enableAgentMode: false, heterogeneous: false });

    const { result } = renderHook(() => useStore());
    const file = new File(['Masterino marker: amber-29'], 'note.txt', { type: 'text/plain' });
    const uploadWithProgress = vi.fn().mockImplementation(async ({ onStatusUpdate }) => {
      onStatusUpdate?.({
        id: 'note.txt',
        type: 'updateFile',
        value: {
          fileUrl: 'http://x/4',
          id: 'file-4',
          status: 'success',
          uploadState: { progress: 100, restTime: 0, speed: 0 },
        },
      });

      return { id: 'file-4', url: 'http://x/4' };
    });
    let resolveParse: (value: unknown) => void;
    const parsePromise = new Promise((resolve) => {
      resolveParse = resolve;
    });
    vi.mocked(ragService.parseFileContent).mockReturnValue(parsePromise as never);

    act(() => {
      useStore.setState({
        chatUploadFileList: [],
        uploadWithProgress: uploadWithProgress as any,
      });
    });

    const uploadPromise = result.current.uploadChatFiles([file], AGENT_ID);

    await waitFor(() => {
      expect(result.current.chatUploadFileList[0]).toMatchObject({
        id: 'file-4',
        processStage: 'content_parsing',
        status: 'processing',
      });
    });

    resolveParse!({ content: 'parsed body' });
    await act(async () => {
      await uploadPromise;
    });

    expect(ragService.parseFileContent).toHaveBeenCalledWith('file-4');
    expect(result.current.chatUploadFileList[0]).toMatchObject({
      id: 'file-4',
      processStage: 'ready_for_chat',
      status: 'success',
    });
  });
});

describe('scoped chat attachment drafts', () => {
  beforeEach(() => {
    useStore.setState({
      chatAttachmentScope: undefined,
      chatAttachmentDrafts: {},
      chatUploadFileList: [],
      chatAttachmentIssues: [],
      chatAttachmentNoticeShown: false,
    });
  });
  it('restores queued files to their owner after another conversation becomes active', () => {
    const store = useStore.getState();
    store.setChatAttachmentScope('topic-a');
    store.dispatchChatUploadFileList(
      { type: 'addFile', file: { id: 'a', file: new File(['a'], 'a.txt'), status: 'success' } },
      'topic-a',
    );
    expect(
      store.restoreChatUploadFiles(
        [
          {
            id: 'queued',
            file: new File(['b'], 'b.png', { type: 'image/png' }),
            status: 'success',
          },
        ],
        'topic-b',
      ),
    ).toBe(true);
    expect(useStore.getState().chatUploadFileList.map((file) => file.id)).toEqual(['a']);
    store.dispatchChatUploadFileList({ type: 'removeFile', id: 'a' });
    expect(useStore.getState().chatUploadFileList.map((file) => file.id)).toEqual(['a']);
    store.setChatAttachmentScope('topic-b');
    expect(useStore.getState().chatUploadFileList).toEqual([
      expect.objectContaining({ id: 'queued', uploadId: expect.any(String) }),
    ]);
  });
  it('rejects an oversized queue restore without changing either draft, including failed slots', () => {
    const store = useStore.getState();
    const images = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      file: new File(['x'], 'image.png', { type: 'image/png' }),
      status: (index ? 'success' : 'error') as 'success' | 'error',
    }));
    store.setChatAttachmentScope('topic-b');
    store.dispatchChatUploadFileList({ type: 'addFiles', files: images }, 'topic-b');
    store.setChatAttachmentScope('topic-a');
    const before = useStore.getState();
    expect(store.restoreChatUploadFiles([images[0]], 'topic-b')).toBe(false);
    expect(sameChatAttachmentDraft(before, useStore.getState(), 'topic-a')).toBe(true);
    expect(sameChatAttachmentDraft(before, useStore.getState(), 'topic-b')).toBe(true);
  });
  it('preserves drafts and late progress in their owning conversation', () => {
    const store = useStore.getState();
    store.setChatAttachmentScope('topic-a');
    store.dispatchChatUploadFileList(
      {
        type: 'addFile',
        file: {
          id: 'a',
          uploadId: 'upload-a',
          file: new File(['a'], 'same.txt'),
          status: 'pending',
        },
      },
      'topic-a',
    );
    const beforeA = useStore.getState();
    store.setChatAttachmentScope('topic-b');
    store.dispatchChatUploadFileList(
      { type: 'addFile', file: { id: 'b', file: new File(['b'], 'same.txt'), status: 'success' } },
      'topic-b',
    );
    const beforeB = useStore.getState();
    store.dispatchChatUploadFileList(
      { type: 'updateFile', id: 'upload-a', value: { status: 'success' } },
      'topic-a',
    );
    expect(sameChatAttachmentDraft(beforeA, useStore.getState(), 'topic-a')).toBe(false);
    expect(sameChatAttachmentDraft(beforeB, useStore.getState(), 'topic-b')).toBe(true);
    expect(useStore.getState().chatUploadFileList.map((item) => item.id)).toEqual(['b']);
    store.clearChatUploadFileList(undefined, 'topic-b');
    store.setChatAttachmentScope('topic-a');
    expect(useStore.getState().chatUploadFileList[0]).toMatchObject({ id: 'a', status: 'success' });
    expect(Object.keys(useStore.getState().chatAttachmentDrafts['topic-a']).sort()).toEqual([
      'chatAttachmentIssues',
      'chatAttachmentNoticeShown',
      'chatUploadFileList',
    ]);
  });
  it('removes only the selected upload when storage deduplicates the file id', async () => {
    const store = useStore.getState();
    store.setChatAttachmentScope('same-content');
    store.dispatchChatUploadFileList(
      {
        type: 'addFiles',
        files: ['first', 'second'].map((uploadId) => ({
          id: 'shared',
          uploadId,
          file: new File(['x'], 'same.png', { type: 'image/png' }),
          status: 'success',
        })),
      },
      'same-content',
    );
    await store.removeChatUploadFile('second', 'same-content');
    expect(useStore.getState().chatUploadFileList.map((item) => item.uploadId)).toEqual(['first']);
  });
});
