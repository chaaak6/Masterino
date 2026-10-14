import { fetchSSE } from '@lobechat/fetch-sse';
import { SendButton } from '@lobehub/editor/react';
import { useState } from 'react';

import { getConversationChatInputUiState } from '@/features/Conversation/ChatInput/utils';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';

const context = {
  agentId: 'stream-bdd-agent',
  scope: 'main' as const,
  topicId: 'stream-bdd-topic',
};
const messageId = 'stream-bdd-message';

/** Real transport, production operation actions/selectors and the production editor Stop button. */
export const StreamRecoveryHarness = () => {
  const state = useOperationState(context);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('idle');
  const [attempts, setAttempts] = useState(0);
  const [opId, setOpId] = useState<string>();
  const [scenario, setScenario] = useState('success');
  const operationStatus = useChatStore((s) => (opId ? s.operations[opId]?.status : 'idle'));
  const loading = state.getMessageOperationState(messageId).isGenerating;
  const { showStopButton } = getConversationChatInputUiState({
    isInputEmpty: true,
    isInputLoading: state.isInputLoading,
  });
  const stop = () => {
    if (opId) useChatStore.getState().cancelOperation(opId, 'BDD user stop');
    setStatus('stopped');
  };
  const run = async () => {
    const store = useChatStore.getState();
    const { operationId, abortController } = store.startOperation({
      context,
      type: 'execAgentRuntime',
    });
    store.associateMessageWithOperation(messageId, operationId);
    setOpId(operationId);
    setContent('');
    setStatus('generating');
    setAttempts(0);
    let failed = false;
    const url = `http://127.0.0.1:14321/?scenario=${scenario}&run=${crypto.randomUUID()}`;
    await fetchSSE(url, {
      method: 'POST',
      fetcher: async (...args) => {
        setAttempts((n) => n + 1);
        return fetch(...args);
      },
      onErrorHandle: () => {
        failed = true;
      },
      onMessageHandle: (chunk) => {
        if (chunk.type === 'text') setContent((s) => s + chunk.text);
      },
      recovery: {
        onAttemptReset: () => setContent(''),
        onRetry: ({ attempt }) => setStatus(`retrying ${attempt}/2`),
      },
      requireTerminalEvent: true,
      signal: abortController.signal,
    });
    if (abortController.signal.aborted) return;
    if (failed) {
      store.failOperation(operationId, {
        message: 'Generation interrupted. Retry available.',
        type: 'stream-error',
      });
      setStatus('failed');
    } else {
      store.completeOperation(operationId);
      setStatus('completed');
    }
  };
  return (
    <section aria-label="Stream recovery acceptance">
      <select
        aria-label="Stream scenario"
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
      >
        {[
          'success',
          'slow',
          'stop',
          'eof-recovery',
          'reset-recovery',
          'always-eof',
          'transient',
          'rate-limit',
          'unauthorized',
          'too-large',
          'provider-error',
          'malformed',
          'nonstream',
        ].map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <button onClick={run} type="button">
        Run stream scenario
      </button>
      <div data-testid="stream-message-loading" data-loading={String(loading)}>
        {loading ? 'Generating report' : 'Message settled'}
      </div>
      <pre data-testid="stream-content">{content}</pre>
      <div data-testid="stream-status">{status}</div>
      <div data-testid="stream-operation-status">{operationStatus}</div>
      <div data-testid="stream-attempts">{attempts}</div>
      <div data-testid="stream-send-state" data-generating={String(showStopButton)}>
        <SendButton generating={showStopButton} onStop={stop} />
      </div>
      {status === 'failed' && (
        <button type="button" onClick={run}>
          Retry generation
        </button>
      )}
    </section>
  );
};
