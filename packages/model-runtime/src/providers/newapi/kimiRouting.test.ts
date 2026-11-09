// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { ChatStreamPayload } from '../../types';
import { LobeNewAPIAI } from './index';

const captureRequest = async (payload: ChatStreamPayload) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      `data: ${JSON.stringify({
        id: 'kimi-regression',
        choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }],
      })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    ),
  );
  const runtime = new LobeNewAPIAI({
    apiKey: 'synthetic-test-key',
    baseURL: 'https://synthetic.invalid',
    fetch,
  });
  const response = await runtime.chat(payload);
  expect(await response.text()).toContain('OK');
  return JSON.parse(String(fetch.mock.calls[0][1]?.body));
};

describe('Aihub Kimi request compatibility at the SDK boundary', () => {
  it.each(['kimi-k3', 'kimi-k3.1-pro'])(
    'normalizes fixed sampling and K3 output controls for %s through the router',
    async (model) => {
      const wire = await captureRequest({
        model,
        stream: true,
        temperature: 1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        n: 2,
        max_tokens: 1024,
        thinking: { type: 'disabled' },
        reasoning_effort: 'high',
        messages: [{ role: 'user', content: 'Reply OK.' }],
      });
      expect(wire).toMatchObject({
        model,
        stream: true,
        max_completion_tokens: 1024,
        reasoning_effort: 'high',
        messages: [{ role: 'user', content: 'Reply OK.' }],
      });
      for (const key of [
        'temperature',
        'top_p',
        'frequency_penalty',
        'presence_penalty',
        'n',
        'max_tokens',
        'thinking',
      ])
        expect(wire).not.toHaveProperty(key);
    },
  );

  it.each(['custom-model', 'kimi-k3.1-pro-custom'])(
    'keeps generic sampling controls for unrelated exact ID %s',
    async (model) => {
      const wire = await captureRequest({
        model,
        stream: true,
        top_p: 1,
        temperature: 0.5,
        n: 2,
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Reply OK.' }],
      });
      expect(wire).toMatchObject({ model, top_p: 1, temperature: 0.5, n: 2, max_tokens: 1024 });
      expect(wire).not.toHaveProperty('max_completion_tokens');
      expect(wire).not.toHaveProperty('thinking');
    },
  );

  it('keeps K2.7 Code output controls and reasoning/tool continuation intact', async () => {
    const wire = await captureRequest({
      model: 'kimi-k2.7-code',
      stream: true,
      top_p: 1,
      n: 2,
      max_tokens: 8192,
      messages: [
        { role: 'user', content: 'Look up a synthetic test item.' },
        {
          role: 'assistant',
          content: '',
          reasoning: { content: 'Synthetic reasoning fixture.' },
          tool_calls: [
            { id: 'lookup-1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'lookup-1', content: 'Synthetic item.' },
      ],
    });
    expect(wire).toMatchObject({ max_tokens: 8192, thinking: { type: 'enabled' } });
    expect(wire).not.toHaveProperty('max_completion_tokens');
    expect(wire).not.toHaveProperty('top_p');
    expect(wire).not.toHaveProperty('n');
    expect(wire.messages[1]).toMatchObject({
      reasoning_content: 'Synthetic reasoning fixture.',
      tool_calls: [{ id: 'lookup-1' }],
    });
    expect(wire.messages[1]).not.toHaveProperty('reasoning');
    expect(wire.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'lookup-1' });
  });
});
