// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AihubGlmRuntime, AihubKimiRuntime, AihubQwenRuntime } from './chatModels';

afterEach(() => vi.restoreAllMocks());

describe.each([
  ['glm-5.3-flash', AihubGlmRuntime],
  ['kimi-k3', AihubKimiRuntime],
  ['qwen3.8-max', AihubQwenRuntime],
] as const)('Aihub %s terminal protocol', (model, Runtime) => {
  it.each([
    { content: '' },
    { content: 'Final text' },
    {
      tool_calls: [
        {
          index: 0,
          id: 'tool-final',
          type: 'function',
          function: { name: 'write', arguments: '{}' },
        },
      ],
    },
  ])('keeps final payload and one stop when usage shares the terminal chunk: %j', async (delta) => {
    const runtime = new Runtime({ apiKey: 'synthetic-test-key' });
    vi.spyOn(runtime.client.chat.completions, 'create').mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue({
            id: 'terminal-acceptance',
            choices: [{ index: 0, delta, finish_reason: 'stop' }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
          });
          controller.close();
        },
      }) as any,
    );
    const response = await runtime.chat({
      model,
      messages: [{ role: 'user', content: 'Synthetic acceptance' }],
      stream: true,
    });
    const output = await response.text();
    expect(output.match(/event: stop\n/g)).toHaveLength(1);
    expect(output).toContain('data: "stop"');
    if ('tool_calls' in delta) expect(output).toContain('event: tool_calls');
    else if (delta.content) expect(output).toContain('data: "Final text"');
    else expect(output).toContain('event: usage');
  });
});
