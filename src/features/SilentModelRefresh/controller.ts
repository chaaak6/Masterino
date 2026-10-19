import type { SilentModelCatalogResponse } from '@lobechat/types';

export const SILENT_MODEL_REFRESH_TIMEOUT = 45_000;
export const SILENT_MODEL_REFRESH_INTERVAL = 30 * 60_000;
export const PANEL_MODEL_REFRESH_COOLDOWN = 2 * 60_000;
const FAILED_PANEL_RETRY_COOLDOWN = 60_000;
export const MODEL_CATALOG_RESET_EVENT = 'masterino:model-catalog-reset';
export const MANUAL_MODEL_REFRESH_EVENT = 'masterino:manual-model-refresh';

type CatalogCheckStatus = 'idle' | 'checking' | 'error';
let catalogCheckStatus: CatalogCheckStatus = 'idle';
const statusListeners = new Set<() => void>();
const setCatalogCheckStatus = (status: CatalogCheckStatus) => {
  if (catalogCheckStatus === status) return;
  catalogCheckStatus = status;
  for (const listener of statusListeners) listener();
};
export const getCatalogCheckStatus = () => catalogCheckStatus;
export const subscribeCatalogCheckStatus = (listener: () => void) => {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
};

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
  private lastSuccess = 0;
  private lastFailure = 0;
  private disabled = false;
  private revision?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private epoch = 0;
  private manual = false;
  private stopped = true;
  constructor(private options: RefreshOptions) {}
  start() {
    this.stopped = false;
    setActiveController(this);
    setCatalogCheckStatus('idle');
    document.addEventListener('visibilitychange', this.onResume);
    window.addEventListener('online', this.onResume);
    window.addEventListener(MANUAL_MODEL_REFRESH_EVENT, this.onManual);
    window.addEventListener(MODEL_CATALOG_RESET_EVENT, this.onReset);
    this.schedule(1000);
    return () => this.stop();
  }
  stop() {
    this.stopped = true;
    if (activeController === this) {
      activeController = undefined;
      setCatalogCheckStatus('idle');
    }
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
    if (!this.lastSuccess || Date.now() - this.lastSuccess >= SILENT_MODEL_REFRESH_INTERVAL)
      void this.requestCheck('resume');
  };
  private onReset = () => {
    this.epoch++;
    this.request?.abort();
    this.revision = undefined;
    this.lastAttempt = Date.now();
    this.lastSuccess = 0;
    this.lastFailure = 0;
    setCatalogCheckStatus('idle');
    this.schedule();
  };
  private onManual = (event: Event) => {
    this.manual = (event as CustomEvent<boolean>).detail;
    this.epoch++;
    this.request?.abort();
    this.revision = undefined;
    this.options.clear();
    this.lastAttempt = Date.now();
    this.lastSuccess = 0;
    this.lastFailure = 0;
    setCatalogCheckStatus('idle');
    this.schedule();
  };
  requestCheck(reason: 'panel' | 'resume' | 'retry' | 'scheduled' = 'scheduled') {
    if (reason === 'panel') {
      if (this.lastFailure && Date.now() - this.lastFailure < FAILED_PANEL_RETRY_COOLDOWN) return;
      if (catalogCheckStatus !== 'error' && this.lastSuccess && Date.now() - this.lastSuccess < PANEL_MODEL_REFRESH_COOLDOWN)
        return;
    }
    if (reason === 'resume' && this.lastAttempt && Date.now() - this.lastAttempt < 60_000)
      return;
    void this.check();
  }
  isAvailable() {
    return !this.stopped && !this.disabled;
  }
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
    setCatalogCheckStatus('checking');
    const deadline = setTimeout(() => request.abort(), SILENT_MODEL_REFRESH_TIMEOUT);
    const epoch = this.epoch;
    this.lastAttempt = Date.now();
    try {
      const response = await this.options.check(this.revision, request.signal);
      if (this.stopped || epoch !== this.epoch) return;
      if (request.signal.aborted) {
        this.lastFailure = Date.now();
        setCatalogCheckStatus('error');
        return;
      }
      if (response.status === 'changed') {
        await this.options.apply(response, request.signal);
        if (!request.signal.aborted && epoch === this.epoch) {
          this.revision = response.revision;
          if (!response.stale) this.lastSuccess = Date.now();
          this.disabled = false;
        }
      } else if (response.status === 'unchanged') {
        this.revision = response.revision;
        if (!response.stale) this.lastSuccess = Date.now();
        this.disabled = false;
      } else if (response.status === 'disabled') {
        this.disabled = true;
        this.revision = undefined;
        this.options.clear();
      }
      if (response.status === 'unavailable' || ('stale' in response && response.stale)) {
        this.lastFailure = Date.now();
        setCatalogCheckStatus('error');
      } else {
        this.lastFailure = 0;
        setCatalogCheckStatus('idle');
      }
    } catch {
      // Keep last successful data. Retry at the next scheduled check or overdue resume.
      if (!this.stopped && epoch === this.epoch) {
        this.lastFailure = Date.now();
        setCatalogCheckStatus('error');
      }
    } finally {
      clearTimeout(deadline);
      if (this.request === request) this.request = undefined;
      this.schedule();
    }
  }
}

let activeController: SilentModelRefreshController | undefined;
const setActiveController = (controller: SilentModelRefreshController) => {
  activeController = controller;
};

/** Returns false when the independent catalog chain is unavailable, preserving the old panel path. */
export const requestPanelModelCatalogCheck = () => {
  if (!activeController?.isAvailable()) return false;
  activeController.requestCheck('panel');
  return true;
};

export const retryPanelModelCatalogCheck = () => activeController?.requestCheck('retry');
