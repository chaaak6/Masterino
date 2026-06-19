import type { NewApiLogItem, NewApiPage, NewApiToken, NewApiUser } from './client';
import type { NewApiReadSource } from './readSource';

interface NewApiBridgeClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  token?: string;
}

class NewApiBridgeError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'NewApiBridgeError';
    this.status = status;
  }
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

const readErrorMessage = (body: unknown, fallback: string) => {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  }

  return fallback;
};

export class NewApiBridgeClient implements NewApiReadSource {
  private baseUrl?: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private token?: string;

  constructor({
    baseUrl = process.env.AIHUB_BRIDGE_URL,
    fetchImpl = fetch,
    timeoutMs = 30_000,
    token = process.env.AIHUB_BRIDGE_TOKEN,
  }: NewApiBridgeClientOptions = {}) {
    this.baseUrl = baseUrl ? normalizeBaseUrl(baseUrl) : undefined;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.token = token;
  }

  isEnabled() {
    return Boolean(this.baseUrl && this.token);
  }

  private buildUrl(path: string, query?: Record<string, number | string | undefined>) {
    if (!this.baseUrl) throw new NewApiBridgeError('AIHUB_BRIDGE_URL is required', 500);

    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  private async request<T>(path: string, query?: Record<string, number | string | undefined>) {
    if (!this.token) throw new NewApiBridgeError('AIHUB_BRIDGE_TOKEN is required', 500);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.buildUrl(path, query), {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        signal: controller.signal,
      });

      const text = await response.text();
      const body = text ? JSON.parse(text) : undefined;

      if (response.status === 404) return undefined;

      if (!response.ok || body?.success === false) {
        throw new NewApiBridgeError(
          readErrorMessage(body, `Aihub bridge request failed with ${response.status}`),
          response.status,
        );
      }

      return body?.data as T;
    } catch (error) {
      if (error instanceof NewApiBridgeError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new NewApiBridgeError('Aihub bridge request timed out', 408);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  findUserByIdentity(identity: { email?: string; username?: string }) {
    return this.request<NewApiUser>('/v1/users/resolve', identity);
  }

  findUserById(userId: number) {
    return this.request<NewApiUser>(`/v1/users/${userId}`);
  }

  findManagedToken(userId: number, tokenName: string) {
    return this.request<NewApiToken>(`/v1/users/${userId}/managed-token`, { name: tokenName });
  }

  async listAccessibleModels(_group?: string, token?: NewApiToken) {
    if (!token?.user_id) return [];

    return (
      (await this.request<string[]>(`/v1/users/${token.user_id}/models`, {
        tokenName: token.name,
      })) || []
    );
  }

  async getUsageLogs(
    userId: number,
    params: {
      endTimestamp?: number;
      page?: number;
      pageSize?: number;
      startTimestamp?: number;
    } = {},
  ) {
    return (
      (await this.request<NewApiPage<NewApiLogItem>>(`/v1/users/${userId}/usage-logs`, params)) || {
        items: [],
        total: 0,
      }
    );
  }
}
