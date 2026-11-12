// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LobeNewAPIAI } from './index';

afterEach(() => vi.restoreAllMocks());

describe('Aihub DeepSeek structured output', () => {
  it.each(['deepseek-flash', 'DeepSeek/deepseek-flash', 'deepseek-v4-flash'])(
    'disables default thinking for forced schema output with %s',
    async (model) => {
      const requests: Record<string, unknown>[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        requests.push(payload);
        // Match the upstream rejection that pauses input completion.
        if (payload.thinking?.type !== 'disabled') {
          return Response.json(
            {
              error: {
                message: 'Forced tool choice requires non-thinking mode',
                type: 'invalid_request_error',
              },
            },
            { status: 400 },
          );
        }
        return Response.json({
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    type: 'function',
                    id: 'schema-output',
                    function: {
                      name: 'input_completion',
                      arguments: '{"completion":"，按优先级排序"}',
                    },
                  },
                ],
              },
            },
          ],
        });
      });
      const runtime = new LobeNewAPIAI({
        apiKey: 'synthetic-test-key',
        baseURL: 'https://aihub.invalid/v1',
        fetch,
      });
      const result = await runtime.generateObject({
        messages: [{ role: 'user', content: '请帮我整理今天的工作计划' }],
        model,
        schema: {
          name: 'input_completion',
          schema: {
            type: 'object',
            properties: { completion: { type: 'string' } },
            required: ['completion'],
            additionalProperties: false,
          },
        },
      });

      expect(result).toEqual({ completion: '，按优先级排序' });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        model,
        thinking: { type: 'disabled' },
        tool_choice: { type: 'function', function: { name: 'input_completion' } },
      });
    },
  );
});
