import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { gatewayConnectionService } from './gatewayConnection';

const ipc = vi.hoisted(() => ({ executeLocalToolCall: vi.fn(), cancelLocalOfficeRead: vi.fn() }));
vi.mock('@/utils/electron/ipc', () => ({ ensureElectronIpc: () => ({ gatewayConnection: ipc }) }));

const request = {
  apiName: 'readOfficeDocument',
  args: { path: 'data.xlsx' },
  trace: {
    deviceId: 'device-1',
    topicId: 'topic-1',
    operationId: 'operation-1',
    toolCallId: 'call-1',
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  ipc.executeLocalToolCall.mockImplementation(() => new Promise(() => {}));
  ipc.cancelLocalOfficeRead.mockResolvedValue({ cancelled: true });
});
afterEach(() => vi.useRealTimers());

it('cancels the exact in-flight Office IPC call when its Runtime signal aborts', async () => {
  const controller = new AbortController();
  const result = gatewayConnectionService.executeLocalToolCall(request, {
    signal: controller.signal,
  });
  controller.abort(new Error('user stopped'));
  await expect(result).rejects.toThrow('user stopped');
  expect(ipc.cancelLocalOfficeRead).toHaveBeenCalledExactlyOnceWith(request.trace);
});

it('times out and cancels a stalled local Office read', async () => {
  vi.useFakeTimers();
  const result = gatewayConnectionService.executeLocalToolCall(request);
  const rejection = expect(result).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(120_000);
  await rejection;
  expect(ipc.cancelLocalOfficeRead).toHaveBeenCalledExactlyOnceWith(request.trace);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not dispatch an Office read that was already cancelled', async () => {
  await expect(
    gatewayConnectionService.executeLocalToolCall(request, {
      signal: AbortSignal.abort(new Error('already stopped')),
    }),
  ).rejects.toThrow('already stopped');
  expect(ipc.executeLocalToolCall).not.toHaveBeenCalled();
});

it('removes abort listeners and timeout after a successful read', async () => {
  vi.useFakeTimers();
  ipc.executeLocalToolCall.mockResolvedValue({ content: 'ok', success: true });
  const controller = new AbortController();
  await gatewayConnectionService.executeLocalToolCall(request, { signal: controller.signal });
  controller.abort();
  expect(ipc.cancelLocalOfficeRead).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not attach read cancellation to Office writes', async () => {
  ipc.executeLocalToolCall.mockResolvedValue({ content: 'saved', success: true });
  const result = await gatewayConnectionService.executeLocalToolCall(
    { ...request, apiName: 'batchOfficeDocument' },
    { signal: AbortSignal.abort() },
  );
  expect(result.success).toBe(true);
  expect(ipc.cancelLocalOfficeRead).not.toHaveBeenCalled();
});
