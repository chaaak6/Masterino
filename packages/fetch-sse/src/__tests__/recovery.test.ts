import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSSE } from '../fetchSSE';

const stream = (text: string, ended = true) =>
  new Response(
    `event: text\ndata: ${JSON.stringify(text)}\n\n` +
      (ended ? 'event: stop\ndata: "stop"\n\n' : ''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );

afterEach(() => vi.restoreAllMocks());

describe('Given a model stream interrupted before completion', () => {
  it.each([false, true])(
    'negotiates strict EOF with the server (supported=%s)',
    async (supported) => {
      const fetcher = vi.fn(
        async () =>
          new Response('event: text\ndata: "legacy answer"\n\n', {
            headers: {
              'Content-Type': 'text/event-stream',
              ...(supported ? { 'X-Masterino-Stream-Protocol': 'terminal-v1' } : {}),
            },
          }),
      );
      const finish = vi.fn();
      await fetchSSE('/test', {
        fetcher,
        requireTerminalEvent: 'negotiated',
        recovery: { delayMs: 0 },
        onFinish: finish,
      });
      expect(fetcher).toHaveBeenCalledTimes(supported ? 3 : 1);
      expect(finish).toHaveBeenCalledWith(
        'legacy answer',
        expect.objectContaining({ type: supported ? 'error' : 'done' }),
      );
    },
  );

  it('clears the retry hint on recovered data before the stream finishes', async () => {
    const recovered = vi.fn();
    const finish = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(stream('Recovered'));
    await fetchSSE('/test', {
      fetcher,
      recovery: { delayMs: 0, onRecovered: recovered },
      onFinish: finish,
      onMessageHandle: () => {
        expect(recovered).toHaveBeenCalledOnce();
        expect(finish).not.toHaveBeenCalled();
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(recovered).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
  });

  it.each([200, 503])(
    'does not announce recovery for an initial success or exhausted errors (%s)',
    async (status) => {
      const recovered = vi.fn();
      const fetcher = vi.fn(async () =>
        status === 200 ? stream('Initial success') : new Response('', { status }),
      );
      await fetchSSE('/test', { fetcher, recovery: { delayMs: 0, onRecovered: recovered } });
      expect(recovered).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(status === 200 ? 1 : 3);
    },
  );

  it('finalizes cancellation before the first request without sending it', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    const finish = vi.fn();
    await fetchSSE('/test', { fetcher, signal: controller.signal, onFinish: finish });
    expect(fetcher).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('', { type: 'abort' });
  });

  it('When the transport closes after a confirmed stop, Then the completed model call is not replayed', async () => {
    const bytes = new TextEncoder().encode(
      'event: text\ndata: "complete"\n\nevent: stop\ndata: "stop"\n\n',
    );
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              setTimeout(() => controller.error(new TypeError('connection reset after stop')), 5);
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    const finish = vi.fn();
    const error = vi.fn();
    await fetchSSE('/test', {
      fetcher,
      onFinish: finish,
      onErrorHandle: error,
      requireTerminalEvent: true,
      recovery: { delayMs: 0 },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('complete', expect.objectContaining({ type: 'done' }));
  });
  it.each(['length', 'max_tokens', 'MAX_TOKENS', 'content_filter', 'SAFETY'])(
    'Then explicit provider stop(%s) is a terminal response, not a transport failure',
    async (reason) => {
      const fetcher = vi.fn(
        async () =>
          new Response(`event: stop\ndata: ${JSON.stringify(reason)}\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      );
      const finish = vi.fn();
      await fetchSSE('/test', {
        fetcher,
        onFinish: finish,
        requireTerminalEvent: true,
        recovery: { delayMs: 0 },
      });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ type: 'done', finishReason: reason }),
      );
    },
  );
  it.each([
    { error: { code: 'ECONNREFUSED' } },
    { error: { code: 'UND_ERR_CONNECT_TIMEOUT' } },
    { error: { code: 'UND_ERR_HEADERS_TIMEOUT' } },
    { error: { cause: { code: 'ECONNREFUSED' } } },
    { error: { message: 'socket hang up' } },
    { error: { status: 503 } },
    { retryable: true, error: {} },
  ])('recovers serialized pre-response transient errors: %j', async (body) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errorType: 'InternalServerError', body }), { status: 500 }),
      )
      .mockResolvedValueOnce(stream('complete'));
    const finish = vi.fn();
    await fetchSSE('/test', { fetcher, recovery: { delayMs: 0 }, onFinish: finish });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledWith('complete', expect.objectContaining({ type: 'done' }));
  });

  it('does not override the server decision that an error is not retryable', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errorType: 'InternalServerError',
          body: { retryable: false, error: { status: 503 } },
        }),
        { status: 500 },
      ),
    );
    const error = vi.fn();
    await fetchSSE('/test', { fetcher, recovery: { delayMs: 0 }, onErrorHandle: error });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it('honors the server rate-limit delay after an upstream 429 is wrapped in HTTP 500', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              errorType: 'InternalServerError',
              body: { retryable: true, retryAfterMs: 2000, error: { status: 429 } },
            }),
            { status: 500 },
          ),
        )
        .mockResolvedValueOnce(stream('complete'));
      const run = fetchSSE('/test', { fetcher, recovery: { delayMs: 0 } });
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetcher).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await run;
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([-1, 31_000])(
    'rejects unsafe serialized Retry-After delays: %s',
    async (retryAfterMs) => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errorType: 'InternalServerError',
            body: { retryable: true, retryAfterMs },
          }),
          { status: 500 },
        ),
      );
      await fetchSSE('/test', { fetcher, recovery: { delayMs: 0 } });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it('When offline recovery expires, Then no request loop occurs', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    let attempts = 0;
    const error = vi.fn();
    try {
      const run = fetchSSE('/test', {
        fetcher: async () => {
          attempts++;
          throw new TypeError('Failed to fetch');
        },
        onErrorHandle: error,
        recovery: { delayMs: 0 },
      });
      await vi.advanceTimersByTimeAsync(31_000);
      await run;
      expect(attempts).toBe(1);
      expect(error).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('When a partial tool call is discarded, Then only the complete retry tool result is committed', async () => {
    let attempt = 0;
    const finish = vi.fn();
    const response = (name: string, ended: boolean) =>
      new Response(
        `event: tool_calls\ndata: ${JSON.stringify([{ id: name, index: 0, type: 'function', function: { name, arguments: '{}' } }])}\n\n` +
          (ended ? 'event: stop\ndata: "tool_calls"\n\n' : ''),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    await fetchSSE('/test', {
      fetcher: async () =>
        ++attempt === 1 ? response('old_tool', false) : response('new_tool', true),
      onFinish: finish,
      requireTerminalEvent: true,
      recovery: { delayMs: 0 },
    });
    expect(finish).toHaveBeenCalledOnce();
    expect(
      finish.mock.calls[0][1].toolCalls.map((t: { function: { name: string } }) => t.function.name),
    ).toEqual(['new_tool']);
  });
  it.each([502, 503, 504])(
    'When HTTP %i is transient, Then the current model call recovers',
    async (status) => {
      let attempts = 0;
      const finish = vi.fn();
      await fetchSSE('/test', {
        fetcher: async () => (++attempts === 1 ? new Response('', { status }) : stream('complete')),
        onFinish: finish,
        recovery: { delayMs: 0 },
      });
      expect(attempts).toBe(2);
      expect(finish).toHaveBeenCalledWith('complete', expect.objectContaining({ type: 'done' }));
    },
  );

  it('Then temporary rate limiting respects Retry-After and quota errors do not loop', async () => {
    let attempts = 0;
    await fetchSSE('/test', {
      fetcher: async () =>
        ++attempts === 1
          ? new Response('', { status: 429, headers: { 'Retry-After': '0' } })
          : stream('complete'),
      recovery: { delayMs: 0 },
    });
    expect(attempts).toBe(2);
    const fetcher = vi.fn(async () => new Response('', { status: 429 }));
    await fetchSSE('/test', { fetcher, recovery: { delayMs: 0 } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('Then complete non-streaming responses and legacy provider EOF remain compatible', async () => {
    const finish = vi.fn();
    await fetchSSE('/test', {
      fetcher: async () => new Response('complete'),
      onFinish: finish,
      requireTerminalEvent: true,
    });
    expect(finish).toHaveBeenCalledWith('complete', expect.objectContaining({ type: 'done' }));
    await fetchSSE('/test', { fetcher: async () => stream('legacy', false), onFinish: finish });
    expect(finish).toHaveBeenCalledWith('legacy', expect.objectContaining({ type: 'done' }));
  });

  it('Then malformed stream data fails without replaying the model call', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('event: text\ndata: invalid-json\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    );
    const finish = vi.fn();
    await fetchSSE('/test', { fetcher, onFinish: finish, recovery: { delayMs: 0 } });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith('', expect.objectContaining({ type: 'error' }));
  });

  it('Then an error persistence callback finishes before the stream commits its final state', async () => {
    const order: string[] = [];
    await fetchSSE('/test', {
      fetcher: async () => stream('partial', false),
      onErrorHandle: async () => {
        await Promise.resolve();
        order.push('error-saved');
      },
      onFinish: async () => {
        order.push('finish');
      },
      requireTerminalEvent: true,
    });
    expect(order).toEqual(['error-saved', 'finish']);
  });
  it('Then an unexpected EOF is an error, not successful completion', async () => {
    const finish = vi.fn();
    const error = vi.fn();
    await fetchSSE('/test', {
      fetcher: async () => stream('<html>partial', false),
      onErrorHandle: error,
      onFinish: finish,
      requireTerminalEvent: true,
    });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ type: 'StreamChunkError' }));
    expect(finish).toHaveBeenCalledWith(
      '<html>partial',
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('When the second attempt succeeds, Then partial output is replaced and only success is committed', async () => {
    let attempts = 0;
    const finish = vi.fn();
    const error = vi.fn();
    const reset = vi.fn();
    await fetchSSE('/test', {
      fetcher: async () => (++attempts === 1 ? stream('old', false) : stream('new')),
      onErrorHandle: error,
      onFinish: finish,
      requireTerminalEvent: true,
      recovery: { delayMs: 0, onAttemptReset: reset },
    });
    expect(attempts).toBe(2);
    expect(reset).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledExactlyOnceWith(
      'new',
      expect.objectContaining({ type: 'done' }),
    );
  });

  it('When all attempts fail, Then retries are bounded and one final error is committed', async () => {
    let attempts = 0;
    const finish = vi.fn();
    const error = vi.fn();
    await fetchSSE('/test', {
      fetcher: async () => {
        attempts++;
        return stream('partial', false);
      },
      onErrorHandle: error,
      onFinish: finish,
      requireTerminalEvent: true,
      recovery: { delayMs: 0 },
    });
    expect(attempts).toBe(3);
    expect(error).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledExactlyOnceWith(
      'partial',
      expect.objectContaining({ type: 'error' }),
    );
  });

  it.each([400, 401, 403, 413])(
    'Then HTTP %i does not trigger an automatic retry',
    async (status) => {
      let attempts = 0;
      const error = vi.fn();
      await fetchSSE('/test', {
        fetcher: async () => {
          attempts++;
          return new Response('', { status });
        },
        onErrorHandle: error,
        recovery: { delayMs: 0 },
      });
      expect(attempts).toBe(1);
      expect(error).toHaveBeenCalledOnce();
    },
  );

  it('When the user stops during backoff, Then no new attempt or late text is delivered', async () => {
    const controller = new AbortController();
    let attempts = 0;
    const chunks = vi.fn();
    const finish = vi.fn();
    await fetchSSE('/test', {
      fetcher: async () => {
        attempts++;
        return stream('partial', false);
      },
      onMessageHandle: chunks,
      onFinish: finish,
      requireTerminalEvent: true,
      recovery: { onRetry: () => controller.abort() },
      signal: controller.signal,
    });
    expect(attempts).toBe(1);
    expect(finish).toHaveBeenCalledWith('partial', expect.objectContaining({ type: 'abort' }));
  });
});
