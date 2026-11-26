import { compressContextHierarchically } from '@lobechat/agent-runtime';
import { countContextTokens } from '@lobechat/context-engine';
import { chainCompressContext } from '@lobechat/prompts';
import type { UIChatMessage } from '@lobechat/types';
import type {
  ContextBudgetTrigger,
  ContextCompressionOutcome,
} from '@lobechat/types/src/contextBudget';
import type { ModelCatalogSnapshot } from '@lobechat/types/src/modelCatalog';

import { chatService, collectClientProviderMediaTokenEstimates } from '@/services/chat';

const createAbortError = () =>
  Object.assign(new Error('Compression cancelled'), { name: 'AbortError' });

export const renderClientMessageForCompression = (message: UIChatMessage) => {
  const content = Array.isArray(message.content)
    ? message.content.map((part: any) => {
        if (part?.type === 'image_url') return '[image attachment]';
        if (part?.type === 'video_url') return '[video attachment]';
        return part?.text ?? part;
      })
    : message.content;

  return `${message.role}: ${typeof content === 'string' ? content : JSON.stringify(content)}`;
};

export const resolveClientCompressionBudget = (
  compressionModel: { model: string; provider: string },
  metadata?: Record<string, any>,
) => {
  const snapshots = [
    metadata?.compressionModelCatalogSnapshot,
    metadata?.modelCatalogSnapshot,
  ] as Array<ModelCatalogSnapshot | undefined>;
  const matching = snapshots.find(
    (snapshot) =>
      snapshot?.entry.modelId === compressionModel.model &&
      snapshot.entry.providerId === compressionModel.provider,
  );

  return Math.max(1, (matching?.entry.contextWindowTokens ?? 32_000) - 1024);
};

export const summarizeClientCompressionRequest = async (params: {
  abortController?: AbortController;
  model: string;
  provider: string;
  request: ReturnType<typeof chainCompressContext> & Record<string, unknown>;
}) => {
  let summary = '';
  let summaryError: unknown;

  await chatService.getChatCompletion(
    {
      ...params.request,
      messages: params.request.messages ?? [],
      model: params.model,
      provider: params.provider,
      stream: true,
    },
    {
      onErrorHandle: (error) => {
        summaryError = error;
      },
      onMessageHandle: (chunk) => {
        if (chunk.type === 'text') summary += chunk.text || '';
      },
      signal: params.abortController?.signal,
    },
  );

  if (params.abortController?.signal.aborted) throw createAbortError();
  if (summaryError) throw summaryError;
  if (!summary) throw new Error('summary model returned empty output');
  return summary;
};

interface ClientCompressionTransactionInput {
  abortController?: AbortController;
  candidateIds: readonly string[];
  compressionModel: { model: string; provider: string };
  createGroup: () => Promise<{ messageGroupId: string; messagesToSummarize?: UIChatMessage[] }>;
  failGroup: (messageGroupId: string) => Promise<unknown>;
  finalizeGroup: (
    messageGroupId: string,
    summary: string,
  ) => Promise<{ messages?: UIChatMessage[] }>;
  metadata?: Record<string, any>;
  rollbackGroup: (messageGroupId: string) => Promise<unknown>;
  sourceMessages: UIChatMessage[];
  tools?: unknown[];
  trigger: ContextBudgetTrigger;
}

export type ClientCompressionTransactionResult =
  | {
      finalizedMessages: UIChatMessage[];
      groupId: string;
      kind: 'success';
      outcome: ContextCompressionOutcome;
      providerMessages: UIChatMessage[];
      summary: string;
    }
  | {
      error?: unknown;
      groupId?: string;
      kind: 'failed';
      outcome: ContextCompressionOutcome;
      rollbackError?: unknown;
    };

/**
 * The shared client compression transaction. It never exposes placeholder/finalized messages;
 * callers may project `finalizedMessages` only after this function returns `success`.
 */
export const runClientContextCompressionTransaction = async (
  input: ClientCompressionTransactionInput,
): Promise<ClientCompressionTransactionResult> => {
  const before = countContextTokens({
    messages: input.sourceMessages,
    providerMedia: collectClientProviderMediaTokenEstimates(input.sourceMessages),
    tools: input.tools as any,
  });
  const failureOutcome = (): ContextCompressionOutcome => ({
    afterTokens: before.adjustedTotal,
    attempt: 1,
    beforeTokens: before.adjustedTotal,
    code: 'SUMMARY_FAILED',
    outcome: 'failed',
    payloadFingerprint: before.payloadFingerprint,
    trigger: input.trigger,
  });
  let groupId: string | undefined;

  try {
    const group = await input.createGroup();
    groupId = group.messageGroupId;
    const sourceById = new Map(group.messagesToSummarize?.map((message) => [message.id, message]));
    let finalSummary = '';
    const hierarchy = await compressContextHierarchically<
      UIChatMessage,
      ReturnType<typeof chainCompressContext>
    >({
      buildRequest: (items) =>
        chainCompressContext(
          items.map(
            (item, index) =>
              ({
                content: item.text,
                createdAt: Date.now(),
                id: `summary-input-${index}`,
                role: 'user',
                updatedAt: Date.now(),
              }) as UIChatMessage,
          ),
        ),
      candidateIds: input.candidateIds,
      createSummaryMessage: (summary, candidateIds, compressionGroupId) => {
        finalSummary = summary;
        return {
          content: `[Conversation summary]\n${summary}`,
          createdAt: Date.now(),
          id: compressionGroupId,
          metadata: { contextBudget: { candidateIds } },
          role: 'user',
          updatedAt: Date.now(),
        } as UIChatMessage;
      },
      getMessageId: (message, index) => message.id || `compression-message-${index}`,
      groupId,
      measurePayload: (messages) => {
        const measurement = countContextTokens({
          messages: [...messages],
          providerMedia: collectClientProviderMediaTokenEstimates([...messages]),
          tools: input.tools as any,
        });
        return {
          payloadFingerprint: measurement.payloadFingerprint,
          tokens: measurement.adjustedTotal,
        };
      },
      measureRequest: (request) =>
        countContextTokens({ messages: (request.messages ?? []) as UIChatMessage[] }).adjustedTotal,
      messages: input.sourceMessages,
      renderMessage: (message) =>
        renderClientMessageForCompression(sourceById.get(message.id) ?? message),
      summarize: (request) =>
        summarizeClientCompressionRequest({
          abortController: input.abortController,
          model: input.compressionModel.model,
          provider: input.compressionModel.provider,
          request: request as ReturnType<typeof chainCompressContext> & Record<string, unknown>,
        }),
      summaryModelBudgetTokens: resolveClientCompressionBudget(
        input.compressionModel,
        input.metadata,
      ),
      trigger: input.trigger,
    });

    if (hierarchy.outcome.outcome !== 'compressed' || !finalSummary) {
      throw Object.assign(new Error('SUMMARY_FAILED'), { compressionOutcome: hierarchy.outcome });
    }

    const finalized = await input.finalizeGroup(groupId, finalSummary);
    if (!Array.isArray(finalized.messages)) throw new Error('SUMMARY_PERSISTENCE_REQUIRED');

    return {
      finalizedMessages: finalized.messages,
      groupId,
      kind: 'success',
      outcome: hierarchy.outcome,
      providerMessages: hierarchy.messages,
      summary: finalSummary,
    };
  } catch (error) {
    let rollbackError: unknown;
    if (groupId) {
      try {
        const cancelled =
          input.abortController?.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError');
        if (cancelled) {
          await input.rollbackGroup(groupId);
        } else {
          await input.failGroup(groupId);
        }
      } catch (caught) {
        rollbackError = caught;
      }
    }
    const compressionOutcome =
      error && typeof error === 'object' && 'compressionOutcome' in error
        ? (error.compressionOutcome as ContextCompressionOutcome)
        : failureOutcome();
    return {
      error,
      groupId,
      kind: 'failed',
      outcome: compressionOutcome,
      rollbackError,
    };
  }
};
