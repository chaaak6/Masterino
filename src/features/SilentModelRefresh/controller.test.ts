import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MANUAL_MODEL_REFRESH_EVENT,
  SILENT_MODEL_REFRESH_INTERVAL,
  SilentModelRefreshController,
} from './controller';

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});
describe('silent refresh scheduling and races', () => {
  it('discards a late response when a manual refresh starts', async () => {
    let resolve!: (value: any) => void;
    const sink = { apply: () => {}, clear: () => {} };
    const apply = vi.spyOn(sink, 'apply');
    const controller = new SilentModelRefreshController({
      check: () =>
        new Promise((r) => {
          resolve = r;
        }),
      apply: sink.apply,
      clear: sink.clear,
    });
    stop = controller.start();
    await vi.advanceTimersByTimeAsync(1001);
    window.dispatchEvent(new CustomEvent(MANUAL_MODEL_REFRESH_EVENT, { detail: true }));
    resolve({ status: 'changed', revision: 'old', models: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(apply).not.toHaveBeenCalled();
  });
  it('does not duplicate an in-flight probe when the window resumes repeatedly', async () => {
    let resolve!: (value: any) => void;
    const source = {
      check: () =>
        new Promise<any>((r) => {
          resolve = r;
        }),
    };
    const check = vi.spyOn(source, 'check');
    const controller = new SilentModelRefreshController({
      check: source.check,
      apply: () => {},
      clear: () => {},
    });
    stop = controller.start();
    await vi.advanceTimersByTimeAsync(1001);
    await vi.advanceTimersByTimeAsync(SILENT_MODEL_REFRESH_INTERVAL);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(check).toHaveBeenCalledTimes(1);
    resolve({ status: 'unchanged', revision: 'same', stale: false });
    await vi.advanceTimersByTimeAsync(1);
  });
  it('aborts outstanding work and never applies responses after unmount', async () => {
    let signal!: AbortSignal;
    let resolve!: (value: any) => void;
    const sink = { apply: () => {} };
    const apply = vi.spyOn(sink, 'apply');
    const controller = new SilentModelRefreshController({
      check: (_, s) => {
        signal = s;
        return new Promise((r) => {
          resolve = r;
        });
      },
      apply: sink.apply,
      clear: () => {},
    });
    stop = controller.start();
    await vi.advanceTimersByTimeAsync(1001);
    controller.stop();
    expect(signal.aborted).toBe(true);
    resolve({ status: 'changed', revision: 'late', models: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(apply).not.toHaveBeenCalled();
  });
});
