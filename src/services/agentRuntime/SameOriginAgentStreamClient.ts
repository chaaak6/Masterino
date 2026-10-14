import type { AgentStreamClientEvents, AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { fetchEventSource } from '@lobechat/utils/client';

import { aiAgentService } from '@/services/aiAgent';

/** Server executes tools through Device Gateway; this channel only receives events. */
export class SameOriginAgentStreamClient {
  private listeners = new Map<keyof AgentStreamClientEvents, Set<(...args: never[]) => void>>();
  private controller?: AbortController;
  private retry?: ReturnType<typeof setTimeout>;
  private cursor = '0';
  private stopped = true;
  private terminal = false;
  private retryDelay = 1000;
  private recoveryStartedAt?: number;
  private failedConnections = 0;

  constructor(
    private readonly operationId: string,
    private readonly topicId: string,
  ) {}

  on<K extends keyof AgentStreamClientEvents>(
    event: K,
    listener: AgentStreamClientEvents[K],
  ): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  private emit<K extends keyof AgentStreamClientEvents>(
    event: K,
    ...args: Parameters<AgentStreamClientEvents[K]>
  ) {
    for (const listener of this.listeners.get(event) ?? []) listener(...(args as never[]));
  }

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  private open(): void {
    if (this.stopped || this.terminal) return;
    if (
      this.recoveryStartedAt !== undefined &&
      typeof navigator !== 'undefined' &&
      !navigator.onLine
    ) {
      if (this.expireRecovery()) return;
      this.emit('status_changed', 'reconnecting');
      this.retry = setTimeout(() => this.open(), 1000);
      return;
    }
    this.controller = new AbortController();
    const controller = this.controller;
    const params = new URLSearchParams({
      lastEventId: this.cursor,
      operationId: this.operationId,
      topicId: this.topicId,
    });
    this.emit('status_changed', 'connecting');
    void fetchEventSource(`/api/agent/events?${params}`, {
      credentials: 'same-origin',
      onopen: async (response) => {
        if (this.stopped || this.terminal || this.controller !== controller) return;
        if ([400, 401, 403, 404].includes(response.status)) {
          this.stopped = true;
          controller.abort();
          this.emit('agent_event', {
            data: {
              message: `Unable to receive agent results (${response.status}). Reopen the topic to reload saved messages.`,
              type: 'AgentStreamError',
            },
            operationId: this.operationId,
            stepIndex: 0,
            timestamp: Date.now(),
            type: 'error',
          });
          this.emit('auth_failed', `Stream unavailable (${response.status})`);
          throw new Error('Stream authorization failed');
        }
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
          throw new Error(`Invalid stream response (${response.status})`);
        }
        this.emit('status_changed', 'connected');
        this.emit('connected');
      },
      onmessage: (message) => {
        if (!message.data || this.stopped || this.terminal || this.controller !== controller)
          return;
        const event = JSON.parse(message.data) as AgentStreamEvent;
        if (event.operationId !== this.operationId) throw new Error('Stream operation mismatch');
        if (message.id && message.id === this.cursor) return;
        this.recoveryStartedAt = undefined;
        this.failedConnections = 0;
        this.retryDelay = 1000;
        this.emit('agent_event', event);
        this.cursor = message.id || event.id || this.cursor;
        if (event.type === 'agent_runtime_end') {
          this.terminal = true;
          controller.abort();
          this.emit('session_complete');
        }
      },
      // A transport failure is recoverable. Only an exhausted subscription is a task/UI error.
      onerror: () => {},
      signal: controller.signal,
    }).finally(() => {
      if (this.stopped || this.terminal || this.controller !== controller) return;
      this.recoveryStartedAt ??= Date.now();
      this.failedConnections += 1;
      if (this.expireRecovery()) return;
      this.emit('status_changed', 'reconnecting');
      this.emit('reconnecting', this.retryDelay);
      this.retry = setTimeout(() => this.open(), this.retryDelay);
      this.retryDelay = Math.min(30_000, this.retryDelay * 2);
    });
  }

  private expireRecovery(): boolean {
    if (this.failedConnections < 3 && Date.now() - (this.recoveryStartedAt ?? Date.now()) < 30_000)
      return false;
    this.terminal = true;
    this.emit('agent_event', {
      data: {
        message:
          'Connection interrupted. The server task may still be running. Reopen this topic to recover saved results.',
        type: 'AgentStreamError',
      },
      operationId: this.operationId,
      stepIndex: 0,
      timestamp: Date.now(),
      type: 'error',
    });
    this.emit('session_complete');
    return true;
  }

  disconnect(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    this.controller?.abort();
    this.emit('status_changed', 'disconnected');
    this.emit('disconnected');
  }

  async reconnect(): Promise<void> {
    clearTimeout(this.retry);
    this.controller?.abort();
    this.stopped = false;
    this.open();
  }

  sendInterrupt(): void {
    void aiAgentService
      .interruptTask({ operationId: this.operationId, topicId: this.topicId })
      .catch((error: Error) => this.emit('error', error));
  }

  sendToolResult(): boolean {
    return false;
  }
  updateToken(): void {
    /* Authentication uses the existing same-origin session. */
  }
}
