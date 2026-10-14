import { fetchEventSource } from '@lobechat/utils/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SameOriginAgentStreamClient } from './SameOriginAgentStreamClient';

vi.mock('@lobechat/utils/client', () => ({ fetchEventSource: vi.fn() }));
vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { interruptTask: vi.fn().mockResolvedValue({}) },
}));

describe('same-origin device agent stream', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });
  it('Given repeated transport failures, Then it stops reconnecting without claiming server success', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchEventSource).mockImplementation(async (_url, options) => {
      await options.onerror?.(new TypeError('connection reset'));
    });
    const client = new SameOriginAgentStreamClient('op', 'topic');
    const event = vi.fn();
    const complete = vi.fn();
    client.on('agent_event', event);
    client.on('session_complete', complete);
    client.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchEventSource).toHaveBeenCalledTimes(3);
    expect(event).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(complete).toHaveBeenCalledOnce();
    client.disconnect();
  });
  it('only completes after terminal event and reconnects from last delivered ID', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    vi.mocked(fetchEventSource).mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const client = new SameOriginAgentStreamClient('op', 'topic');
    const complete = vi.fn();
    const event = vi.fn();
    client.on('session_complete', complete);
    client.on('agent_event', event);
    client.connect();
    const first = vi.mocked(fetchEventSource).mock.calls[0][1];
    await first.onopen(new Response('', { headers: { 'Content-Type': 'text/event-stream' } }));
    first.onmessage!({
      data: JSON.stringify({ operationId: 'op', type: 'stream_chunk' }),
      event: '',
      id: '100-1',
    });
    resolve();
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(fetchEventSource).mock.calls[1][0]).toContain('lastEventId=100-1');
    const second = vi.mocked(fetchEventSource).mock.calls[1][1];
    second.onmessage!({
      data: JSON.stringify({ operationId: 'op', type: 'agent_runtime_end' }),
      event: '',
      id: '100-2',
    });
    expect(event).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(1);
    resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchEventSource).toHaveBeenCalledTimes(2);
    client.disconnect();
  });
  it('does not retry authorization rejection or an intentional disconnect', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchEventSource).mockImplementation(async (_url, options) => {
      try {
        await options.onopen(new Response('', { status: 404 }));
      } catch {
        /* The real transport reports opening failures through onerror. */
      }
    });
    const client = new SameOriginAgentStreamClient('op', 'topic');
    const failed = vi.fn();
    client.on('auth_failed', failed);
    client.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(failed).toHaveBeenCalledWith('Stream unavailable (404)');
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
    expect(client.sendToolResult()).toBe(false);
    client.disconnect();
  });
});
