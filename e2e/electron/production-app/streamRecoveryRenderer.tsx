import { fetchSSE } from '@lobechat/fetch-sse';
import { SendButton } from '@lobehub/editor/react';
import { useState } from 'react';

import { getConversationChatInputUiState } from '@/features/Conversation/ChatInput/utils';
import { useOperationState } from '@/hooks/useOperationState';
import { messageService } from '@/services/message';
import { useChatStore } from '@/store/chat';
import { createGatewayEventHandler } from '@/store/chat/slices/aiChat/actions/gatewayEventHandler';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors/dbMessage';

const context = {
  agentId: 'stream-bdd-agent',
  scope: 'main' as const,
  topicId: 'stream-bdd-topic',
};
const messageId = 'stream-bdd-message';
const originalFetch = globalThis.fetch.bind(globalThis);
// Only map the subscription transport boundary; production parsing/recovery stays intact.
globalThis.fetch = (input, init) =>
  originalFetch(
    typeof input === 'string' && input.startsWith('/api/agent/events?')
      ? `http://127.0.0.1:14321/${input.slice(input.indexOf('?'))}&scenario=${new URLSearchParams(input.split('?')[1]).get('topicId')?.split(':')[0]}`
      : input,
    init,
  );

/** Real transport, production operation actions/selectors and the production editor Stop button. */
export const StreamRecoveryHarness = () => {
  const [activeContext, setActiveContext] = useState(context);
  const state = useOperationState(activeContext);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('idle');
  const [attempts, setAttempts] = useState(0);
  const [opId, setOpId] = useState<string>();
  const [scenario, setScenario] = useState('success');
  const operationStatus = useChatStore((s) => (opId ? s.operations[opId]?.status : 'idle'));
  const recovery = useChatStore((s) =>
    opId ? s.operations[opId]?.metadata.streamRecovery : undefined,
  );
  const syncError = useChatStore((s) =>
    opId ? s.operations[opId]?.metadata.resultSyncError : undefined,
  );
  const gatewayMessage = useChatStore(dbMessageSelectors.getDbMessageById(messageId));
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
    const runContext = scenario.startsWith('gateway-')
      ? { ...context, topicId: `${scenario}:${crypto.randomUUID()}` }
      : context;
    setActiveContext(runContext);
    const { operationId, abortController } = store.startOperation({
      context: runContext,
      type: 'execAgentRuntime',
    });
    store.associateMessageWithOperation(messageId, operationId);
    setOpId(operationId);
    setContent('');
    setStatus('generating');
    setAttempts(0);
    if (scenario.startsWith('gateway-')) {
      store.replaceMessages(
        [
          {
            id: messageId,
            role: 'assistant',
            content: '',
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        { context: runContext },
      );
      const serverOperationId = `server-${operationId}`;
      const handler = createGatewayEventHandler(useChatStore.getState, {
        assistantMessageId: messageId,
        context: runContext,
        operationId,
        gatewayOperationId: serverOperationId,
      });
      store.connectToGateway({
        operationId: serverOperationId,
        localOperationId: operationId,
        topicId: runContext.topicId,
        onEvent: handler,
        onSessionComplete: (error) => {
          if (error)
            store.failOperation(operationId, { type: 'AgentStreamError', message: error.message });
          else store.completeOperation(operationId);
          if (useChatStore.getState().operations[operationId]?.status !== 'cancelled')
            setStatus(useChatStore.getState().operations[operationId]?.status ?? 'failed');
        },
      });
      return;
    }
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
        onRetry: (recovery) => {
          store.updateOperationMetadata(operationId, { streamRecovery: recovery });
          setStatus(`retrying ${recovery.attempt}/2`);
        },
        onRecovered: () => {
          store.updateOperationMetadata(operationId, { streamRecovery: undefined });
          setStatus('generating');
        },
      },
      requireTerminalEvent: 'negotiated',
      signal: abortController.signal,
    });
    store.updateOperationMetadata(operationId, { streamRecovery: undefined });
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
          'recovery-long',
          'always-eof',
          'transient',
          'rate-limit',
          'unauthorized',
          'too-large',
          'provider-error',
          'malformed',
          'nonstream',
          'legacy-eof',
          'length',
          'MAX_TOKENS',
          'ECONNREFUSED',
          'UND_ERR_CONNECT_TIMEOUT',
          'UND_ERR_HEADERS_TIMEOUT',
          'socket-hang-up',
          'nested-503',
          'server-retryable',
          'quota',
          'gateway-quiet',
          'gateway-immediate',
          'gateway-error',
          'gateway-sync-fail',
          'gateway-late-error',
          'gateway-snapshot-cancel',
          'gateway-snapshot-timeout',
          'wrapped-rate-limit',
        ].map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <button disabled={operationStatus === 'running'} type="button" onClick={run}>
        Run stream scenario
      </button>
      <div data-loading={String(loading)} data-testid="stream-message-loading">
        {loading ? 'Generating report' : 'Message settled'}
      </div>
      <pre data-testid="stream-content">
        {scenario.startsWith('gateway-') ? gatewayMessage?.content : content}
      </pre>
      <div data-testid="stream-recovery">{recovery ? 'recovering' : ''}</div>
      <button
        disabled={operationStatus !== 'completed'}
        type="button"
        onClick={() => {
          if (opId)
            useChatStore
              .getState()
              .failOperation(opId, { type: 'AgentStreamError', message: 'late teardown' });
        }}
      >
        Deliver late teardown error
      </button>
      <div data-testid="stream-sync-error">{syncError}</div>
      <div data-testid="stream-inline-error">{gatewayMessage?.error?.message}</div>
      {syncError && (
        <button
          type="button"
          onClick={async () => {
            const current = useChatStore.getState();
            const ctx = current.operations[opId!].context;
            const messages = await messageService.getMessages(ctx);
            current.replaceMessages(messages, { context: ctx });
            current.updateOperationMetadata(opId!, { resultSyncError: undefined });
          }}
        >
          Refresh saved results
        </button>
      )}
      <div data-testid="stream-status">{status}</div>
      <div data-testid="stream-operation-status">{operationStatus}</div>
      <div data-testid="stream-attempts">{attempts}</div>
      <div data-generating={String(showStopButton)} data-testid="stream-send-state">
        <SendButton generating={showStopButton} onStop={stop} />
      </div>
      {status === 'failed' && (
        <button disabled={operationStatus === 'running'} type="button" onClick={run}>
          Retry generation
        </button>
      )}
    </section>
  );
};
