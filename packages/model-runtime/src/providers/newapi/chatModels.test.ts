import { describe, expect, it } from 'vitest';

import type { ChatStreamPayload } from '../../types';
import { buildAihubGlmPayload, buildAihubKimiPayload, buildAihubQwenPayload } from './chatModels';

const payload = (model: string): ChatStreamPayload => ({
  model,
  messages: [{ role: 'user', content: 'hello' }],
  stream: true,
});

describe('exact Aihub chat model parameter adapters', () => {
  it('keeps GLM 5.3 thinking enabled and its history intact even if the old user config disabled it', () => {
    const result = buildAihubGlmPayload({ ...payload('glm-5.3'), thinking: { type: 'disabled' } });
    expect(result.thinking).toEqual({ type: 'enabled', clear_thinking: false });
    expect(
      buildAihubGlmPayload({ ...payload('glm-5.2'), thinking: { type: 'disabled' } }).thinking.type,
    ).toBe('disabled');
  });
  it('omits Kimi fixed sampling parameters and preserves reasoning/tool messages', () => {
    const input = {
      ...payload('kimi-k3'),
      temperature: 0.2,
      top_p: 0.5,
      frequency_penalty: 1,
      presence_penalty: 1,
      max_tokens: 1024,
      thinking: { type: 'disabled' as const },
    };
    const result = buildAihubKimiPayload(input);
    expect(result).toMatchObject({ thinking: { type: 'enabled' }, max_completion_tokens: 1024 });
    for (const key of [
      'temperature',
      'top_p',
      'frequency_penalty',
      'presence_penalty',
      'enabledSearch',
      'max_tokens',
    ])
      expect(result).not.toHaveProperty(key);
    const continuation = buildAihubKimiPayload({
      ...payload('kimi-k3'),
      messages: [{ role: 'assistant', content: 'done', reasoning: { content: 'thinking' } }],
    });
    expect(continuation.messages[0]).toMatchObject({
      role: 'assistant',
      content: 'done',
      reasoning_content: 'thinking',
    });
    expect(continuation.messages[0]).not.toHaveProperty('reasoning');
    const k27 = buildAihubKimiPayload({ ...payload('kimi-k2.7-code'), max_tokens: 8192 });
    expect(k27).toHaveProperty('max_tokens', 8192);
    expect(k27).not.toHaveProperty('max_completion_tokens');
  });
  it('translates Qwen thinking controls and prevents simultaneous effort and budget', () => {
    const result = buildAihubQwenPayload({
      ...payload('qwen3.8-max'),
      thinking: { type: 'enabled', budget_tokens: 1000 },
      reasoning_effort: 'medium',
    });
    expect(result.enable_thinking).toBe(true);
    expect(result.reasoning_effort).toBe('medium');
    expect(result).not.toHaveProperty('thinking_budget');
    const invalid = buildAihubQwenPayload({ ...payload('qwen3.8-max'), reasoning_effort: 'high' });
    expect(invalid).not.toHaveProperty('reasoning_effort');
  });
});
