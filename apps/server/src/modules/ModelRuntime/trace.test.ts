// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTraceOptions } from './trace';

const mocks = vi.hoisted(() => ({
  createTrace: vi.fn(),
  generation: vi.fn(),
  generationUpdate: vi.fn(),
  shutdownAsync: vi.fn(),
  traceUpdate: vi.fn(),
}));

vi.mock('@/libs/traces', () => ({
  TraceClient: vi.fn().mockImplementation(() => ({
    createTrace: mocks.createTrace,
    shutdownAsync: mocks.shutdownAsync,
  })),
}));

vi.mock('next/server', () => ({ after: vi.fn((callback) => callback()) }));

describe('createTraceOptions', () => {
  it('omits inline image bytes from trace input and output without modifying the request', async () => {
    const image = 'data:image/png;base64,c3ludGhldGlj';
    const payload = { messages: [{ role: 'user' as const, content: image }], model: 'test' };
    const options = createTraceOptions(payload, { provider: 'openai' });
    await options.callback.onCompletion?.({ text: image });
    expect(JSON.stringify(mocks.createTrace.mock.calls)).not.toContain('c3ludGhldGlj');
    expect(JSON.stringify(mocks.generation.mock.calls)).not.toContain('c3ludGhldGlj');
    expect(JSON.stringify(mocks.generationUpdate.mock.calls)).not.toContain('c3ludGhldGlj');
    expect(JSON.stringify(mocks.traceUpdate.mock.calls)).not.toContain('c3ludGhldGlj');
    expect(mocks.createTrace.mock.calls[0][0].input[0].content).toBe('[inline image omitted]');
    expect(payload.messages[0].content).toBe(image);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generation.mockReturnValue({ id: 'observation-1', update: mocks.generationUpdate });
    mocks.createTrace.mockReturnValue({
      generation: mocks.generation,
      id: 'trace-1',
      update: mocks.traceUpdate,
    });
  });

  it('records failed generations and flushes the trace', async () => {
    const options = createTraceOptions(
      { messages: [{ content: 'hello', role: 'user' }], model: 'deepseek-v4-flash' },
      {
        provider: 'newapi',
        shutdownMode: 'immediate',
        trace: { enabled: true, traceId: 'trace-1', userId: 'user-1' },
      },
    );

    await options.callback.onError?.({ message: 'socket hang up' });
    await options.callback.onFinal?.({} as any);

    expect(mocks.generationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        endTime: expect.any(Date),
        level: 'ERROR',
        output: { error: 'socket hang up' },
        statusMessage: 'socket hang up',
      }),
    );
    expect(mocks.traceUpdate).toHaveBeenCalledWith({ output: { error: 'socket hang up' } });
    expect(mocks.shutdownAsync).toHaveBeenCalledOnce();
  });

  it('records an upstream timeout once without overwriting it as a successful completion', async () => {
    const options = createTraceOptions(
      { messages: [{ content: 'hello', role: 'user' }], model: 'deepseek-v4-flash' },
      {
        metadata: { operationId: 'operation-123' },
        provider: 'newapi',
        shutdownMode: 'immediate',
        trace: { enabled: true, traceId: 'trace-1', userId: 'user-1' },
      },
    );
    const timeoutError = {
      body: {
        operationId: 'operation-123',
        timeoutType: 'upstream_total_timeout',
      },
      message: 'Upstream model request exceeded the total timeout',
      type: 'upstream_timeout',
    };

    await options.callback.onError?.(timeoutError);
    await options.callback.onCompletion?.({ error: timeoutError, text: 'partial' });
    await options.callback.onFinal?.({ error: timeoutError, text: 'partial' });

    expect(mocks.generationUpdate).toHaveBeenCalledOnce();
    expect(mocks.generationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'ERROR',
        metadata: {
          errorType: 'upstream_timeout',
          operationId: 'operation-123',
          timeoutType: 'upstream_total_timeout',
        },
      }),
    );
    expect(mocks.traceUpdate).toHaveBeenCalledOnce();
    expect(mocks.traceUpdate).toHaveBeenCalledWith({
      metadata: {
        errorType: 'upstream_timeout',
        operationId: 'operation-123',
        timeoutType: 'upstream_total_timeout',
      },
      output: { error: 'Upstream model request exceeded the total timeout' },
    });
    expect(mocks.shutdownAsync).toHaveBeenCalledOnce();
  });

  it('serializes object model parameters before sending them to Langfuse', () => {
    createTraceOptions(
      {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'deepseek-v4-flash',
        temperature: 0.2,
        thinking: { budget_tokens: 4096, type: 'enabled' },
      } as any,
      { provider: 'newapi', trace: { enabled: true } },
    );

    expect(mocks.generation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelParameters: {
          temperature: 0.2,
          thinking: '{"budget_tokens":4096,"type":"enabled"}',
        },
      }),
    );
  });
});
