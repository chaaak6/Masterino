import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { params as qwenParams } from '../qwen';
import { params as zhipuParams } from '../zhipu';

// Sources: https://platform.kimi.com/docs/guide/kimi-k2-7-code-quickstart
// https://platform.kimi.ai/docs/guide/kimi-k3-quickstart
// https://docs.qwencloud.com/developer-guides/text-generation/thinking
// These adapters apply only to exact Aihub chat IDs. They never change native providers.
export const buildAihubKimiPayload = (payload: ChatStreamPayload) => {
  const {
    enabledSearch: _enabledSearch,
    frequency_penalty: _frequency_penalty,
    max_tokens,
    presence_penalty: _presence_penalty,
    preserveThinking: _preserveThinking,
    temperature: _temperature,
    thinking: _thinking,
    top_p: _top_p,
    ...rest
  } = payload;
  return {
    ...rest,
    messages: payload.messages.map((message) => {
      const { reasoning, ...restMessage } = message;
      return {
        ...restMessage,
        ...(reasoning?.content !== undefined ? { reasoning_content: reasoning.content } : {}),
      };
    }),
    // Both current Kimi models require thinking. Fixed sampling parameters must be omitted.
    thinking: { type: 'enabled' },
    ...(max_tokens !== undefined
      ? payload.model === 'kimi-k3'
        ? { max_completion_tokens: Math.min(max_tokens, 1_048_576) }
        : { max_tokens }
      : {}),
    stream: payload.stream ?? true,
  };
};
export const AihubKimiRuntime = createOpenAICompatibleRuntime({
  provider: ModelProvider.NewAPI,
  chatCompletion: {
    forceImageBase64: true,
    handlePayload: (payload) =>
      buildAihubKimiPayload(payload) as OpenAI.ChatCompletionCreateParamsStreaming,
  },
});

export const buildAihubGlmPayload = (payload: ChatStreamPayload) =>
  zhipuParams.chatCompletion.handlePayload({
    ...payload,
    ...(payload.model === 'glm-5.3' || payload.model === 'glm-5.3-flash'
      ? { thinking: { type: 'enabled' }, preserveThinking: true }
      : {}),
  });
export const AihubGlmRuntime = createOpenAICompatibleRuntime({
  provider: ModelProvider.NewAPI,
  chatCompletion: { ...zhipuParams.chatCompletion, handlePayload: buildAihubGlmPayload },
});

export const buildAihubQwenPayload = (payload: ChatStreamPayload) => {
  const result = qwenParams.chatCompletion.handlePayload(payload);
  // Qwen's effort and thinking_budget are mutually exclusive.
  if (
    payload.model === 'qwen3.8-max' &&
    payload.reasoning_effort &&
    ['low', 'medium', 'xhigh'].includes(payload.reasoning_effort) &&
    payload.thinking?.type !== 'disabled'
  ) {
    delete result.thinking_budget;
    result.reasoning_effort = payload.reasoning_effort;
  }
  return result;
};
export const AihubQwenRuntime = createOpenAICompatibleRuntime({
  provider: ModelProvider.NewAPI,
  chatCompletion: { ...qwenParams.chatCompletion, handlePayload: buildAihubQwenPayload },
});
