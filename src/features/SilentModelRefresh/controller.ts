import type { SilentModelCatalogResponse } from '@lobechat/types';

export const SILENT_MODEL_REFRESH_TIMEOUT = 45_000;
export const SILENT_MODEL_REFRESH_INTERVAL = 30 * 60_000;
export const MODEL_CATALOG_RESET_EVENT = 'masterino:model-catalog-reset';
export const MANUAL_MODEL_REFRESH_EVENT = 'masterino:manual-model-refresh';

interface RefreshOptions {
  apply: (
    response: Extract<SilentModelCatalogResponse, { status: 'changed' }>,
    signal: AbortSignal,
  ) => Promise<void> | void;
  check: (
    knownRevision: string | undefined,
    signal: AbortSignal,
  ) => Promise<SilentModelCatalogResponse>;
  clear: () => void;
}

/** One scheduler per mounted main interface. Does not wait for chat/CPU idleness. */
export class SilentModelRefreshController {
  private lastAttempt = 0;
  private revision?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private epoch = 0;
  private manual = false;
  private stopped = true;
  constructor(private options: RefreshOptions) {}
  start() {
    this.stopped = false;
    document.addEventListener('visibilitychange', this.onResume);
    window.addEventListener('online', this.onResume);
    window.addEventListener(MANUAL_MODEL_REFRESH_EVENT, this.onManual);
    window.addEventListener(MODEL_CATALOG_RESET_EVENT, this.onReset);
    this.schedule(1000);
    return () => this.stop();
  }
  stop() {
    this.stopped = true;
    this.epoch++;
    this.request?.abort();
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onResume);
    window.removeEventListener('online', this.onResume);
    window.removeEventListener(MANUAL_MODEL_REFRESH_EVENT, this.onManual);
    window.removeEventListener(MODEL_CATALOG_RESET_EVENT, this.onReset);
  }
  private schedule(delay = SILENT_MODEL_REFRESH_INTERVAL) {
    clearTimeout(this.timer);
    if (!this.stopped) this.timer = setTimeout(() => void this.check(), delay);
  }
  private onResume = () => {
    if (!this.lastAttempt || Date.now() - this.lastAttempt >= SILENT_MODEL_REFRESH_INTERVAL)
      void this.check();
  };
  private onReset = () => {
    this.epoch++;
    this.request?.abort();
    this.revision = undefined;
    this.lastAttempt = Date.now();
    this.schedule();
  };
  private onManual = (event: Event) => {
    this.manual = (event as CustomEvent<boolean>).detail;
    this.epoch++;
    this.request?.abort();
    this.revision = undefined;
    this.options.clear();
    this.lastAttempt = Date.now();
    this.schedule();
  };
  private async check() {
    if (
      this.stopped ||
      this.manual ||
      this.request ||
      document.visibilityState !== 'visible' ||
      !navigator.onLine
    ) {
      this.schedule();
      return;
    }
    const request = new AbortController();
    this.request = request;
    const deadline = setTimeout(() => request.abort(), SILENT_MODEL_REFRESH_TIMEOUT);
    const epoch = this.epoch;
    this.lastAttempt = Date.now();
    try {
      const response = await this.options.check(this.revision, request.signal);
      if (this.stopped || request.signal.aborted || epoch !== this.epoch) return;
      if (response.status === 'changed') {
        await this.options.apply(response, request.signal);
        if (!request.signal.aborted && epoch === this.epoch) this.revision = response.revision;
      } else if (response.status === 'unchanged') {
        this.revision = response.revision;
      } else if (response.status === 'disabled') {
        this.revision = undefined;
        this.options.clear();
      }
    } catch {
      // Keep last successful data. Retry at the next scheduled check or overdue resume.
    } finally {
      clearTimeout(deadline);
      if (this.request === request) this.request = undefined;
      this.schedule();
    }
  }
}
