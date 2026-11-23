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

describe.each([
  ['glm-5.3-flash', AihubGlmRuntime],
  ['qwen3.8-max', AihubQwenRuntime],
] as const)('Aihub %s SDK stream end', (model, Runtime) => {
  it.each(['timeout', 'missing-stop'] as const)(
    'emits one structured error on %s',
    async (scenario) => {
      const request = new AbortController();
      const total = new AbortController();
      const signal = AbortSignal.any([request.signal, total.signal]);
      const encoder = new TextEncoder();
      let chunks = 0;
      const fetcher = async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              chunks++;
              if (chunks === 1) {
                controller.enqueue(
                  encoder.encode(
                    'data: ' +
                      JSON.stringify({
                        id: 'synthetic-chunk',
                        choices: [
                          { index: 0, delta: { content: 'partial answer' }, finish_reason: null },
                        ],
                        model,
                        object: 'chat.completion.chunk',
                      }) +
                      '\n\n',
                  ),
                );
                return;
              }
              if (scenario === 'timeout') {
                total.abort(new DOMException('Total model timeout', 'TimeoutError'));
                controller.error(new DOMException('The operation was aborted', 'AbortError'));
                return;
              }
              controller.enqueue(
                encoder.encode(
                  'data: {"id":"synthetic-chunk","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\ndata: [DONE]\n\n',
                ),
              );
              controller.close();
            },
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'X-Oneapi-Request-Id': 'synthetic-upstream',
            },
          },
        );
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const upstreamOptions = {
        apiKey: 'synthetic-test-key',
        baseURL: 'https://example.test/v1',
        fetch: fetcher as typeof fetch,
      };
      const runtime = new Runtime(upstreamOptions);
      const response = await runtime.chat(
        {
          messages: [{ role: 'user', content: 'Synthetic acceptance' }],
          model,
          stream: true,
        },
        {
          abortSignals: { requestSignal: request.signal, totalSignal: total.signal },
          metadata: { operationId: 'synthetic-operation' },
          requestHeaders: { 'X-Request-ID': 'synthetic-attempt' },
          signal,
        },
      );
      const output = await response.text();
      expect(output).toContain('data: "partial answer"');
      expect(output.match(/^event: error$/gm)).toHaveLength(1);
      expect(output).toContain(
        scenario === 'timeout' ? '"type":"upstream_timeout"' : '"reason":"unexpected_end"',
      );
      expect(info).toHaveBeenCalledWith(
        '[model-stream:upstream]',
        expect.objectContaining({
          abortSource: scenario === 'timeout' ? 'total_timeout' : undefined,
          operationId: 'synthetic-operation',
          requestId: 'synthetic-attempt',
          upstreamRequestId: 'synthetic-upstream',
        }),
      );
      expect(info).toHaveBeenCalledWith(
        '[model-stream:server]',
        expect.objectContaining({
          terminal: 'error',
          requestId: 'synthetic-attempt',
        }),
      );
    },
  );
});
