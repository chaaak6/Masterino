import type { NewApiLogItem, NewApiPage, NewApiToken, NewApiUser } from './client';
import type { NewApiReadSource } from './readSource';

export type BoundTokenAvailability =
  | 'active'
  | 'disabled'
  | 'expired'
  | 'exhausted'
  | 'deleted'
  | 'missing'
  | 'owner_mismatch';

export interface BoundTokenInspection {
  availability: BoundTokenAvailability;
  token?: Omit<NewApiToken, 'key'> & { allow_ips?: string };
}

export interface BoundTokenPatch {
  allow_ips?: string;
  expired_time?: number;
  group?: string;
  model_limits?: string;
  model_limits_enabled?: boolean;
  remain_quota?: number;
  status?: 1 | 2;
  unlimited_quota?: boolean;
}

interface NewApiBridgeClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  token?: string;
}

export class NewApiBridgeError extends Error {
  code: string;
  status: number;

  constructor(message: string, status: number, code = 'bridge_error') {
    super(message);
    this.name = 'NewApiBridgeError';
    this.code = code;
    this.status = status;
  }
}

export type OAuthBindingResult = { status: 'created' | 'existing' | 'repaired' };

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

const readErrorCode = (body: unknown, fallback: string) => {
  if (body && typeof body === 'object') {
    const error = (body as Record<string, unknown>).error;
    if (error && typeof error === 'object') {
      const code = (error as Record<string, unknown>).code;
      if (typeof code === 'string' && code.trim()) return code;
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

  private async request<T>(
    path: string,
    query?: Record<string, number | string | undefined>,
    options?: { body?: unknown; method?: 'GET' | 'PATCH' },
  ) {
    if (!this.token) throw new NewApiBridgeError('AIHUB_BRIDGE_TOKEN is required', 500);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.buildUrl(path, query), {
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...(options?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        method: options?.method || 'GET',
        signal: controller.signal,
      });

      const text = await response.text();
      const body = text ? JSON.parse(text) : undefined;

      if (response.status === 404) return undefined;

      if (!response.ok || body?.success === false) {
        throw new NewApiBridgeError(
          readErrorMessage(body, `Aihub bridge request failed with ${response.status}`),
          response.status,
          readErrorCode(body, 'bridge_request_failed'),
        );
      }

      return body?.data as T;
    } catch (error) {
      if (error instanceof NewApiBridgeError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new NewApiBridgeError('Aihub bridge request timed out', 408, 'bridge_timeout');
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

  findManagedTokenById(userId: number, tokenId: number) {
    return this.request<NewApiToken>(`/v1/users/${userId}/managed-tokens/${tokenId}`);
  }

  inspectBoundToken(userId: number, tokenId: number) {
    return this.request<BoundTokenInspection>(
      `/v1/users/${userId}/managed-tokens/${tokenId}/inspection`,
    );
  }

  updateBoundToken(userId: number, tokenId: number, patch: BoundTokenPatch) {
    return this.request<BoundTokenInspection>(
      `/v1/users/${userId}/managed-tokens/${tokenId}`,
      undefined,
      { body: patch, method: 'PATCH' },
    );
  }

  async listManagedTokens(userId: number, tokenName: string) {
    return (
      (await this.request<NewApiToken[]>(`/v1/users/${userId}/managed-tokens`, {
        name: tokenName,
      })) || []
    );
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

  /**
   * Reassign a token to a different Aihub user by updating `user_id` directly in the DB.
   * Requires the bridge DB account to have UPDATE privilege on the `tokens` table.
   * Optionally updates the token name in the same request.
   * Returns true if the reassignment succeeded, false otherwise.
   */
  async reassignToken(tokenId: number, targetUserId: number, name?: string): Promise<boolean> {
    if (!this.baseUrl || !this.token) return false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const payload: Record<string, unknown> = { userId: targetUserId };
        if (name) payload.name = name;

        const response = await this.fetchImpl(`${this.baseUrl}/v1/tokens/${tokenId}/reassign`, {
          body: JSON.stringify(payload),
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal: controller.signal,
        });

        if (!response.ok) return false;

        const text = await response.text();
        const body = text ? JSON.parse(text) : undefined;

        return body?.success === true;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }

  /**
   * Link an Aihub user to an OAuth provider (e.g. BIEL IAM) by inserting a row
   * into `user_oauth_bindings` via the bridge. This ensures that when the user
   * later logs in to Aihub directly via IAM SSO, they are matched to the same
   * Aihub account instead of creating a new one.
   *
   * Requires the bridge DB account to have narrowly scoped INSERT/UPDATE
   * privileges on `user_oauth_bindings`.
   */
  async linkOAuthBinding(
    userId: number,
    providerUserId: string,
    providerId?: number,
  ): Promise<OAuthBindingResult> {
    if (!this.baseUrl || !this.token) {
      throw new NewApiBridgeError('Aihub bridge is not configured', 503, 'bridge_unavailable');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const payload: Record<string, unknown> = { providerUserId };
      if (providerId) payload.providerId = providerId;

      const response = await this.fetchImpl(`${this.baseUrl}/v1/users/${userId}/oauth-binding`, {
        body: JSON.stringify(payload),
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });

      const text = await response.text();
      const body = text ? JSON.parse(text) : undefined;
      if (!response.ok || body?.success === false) {
        throw new NewApiBridgeError(
          readErrorMessage(body, `Aihub bridge request failed with ${response.status}`),
          response.status,
          readErrorCode(body, 'bridge_request_failed'),
        );
      }
      return body?.data as OAuthBindingResult;
    } catch (error) {
      if (error instanceof NewApiBridgeError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new NewApiBridgeError('Aihub bridge request timed out', 408, 'bridge_timeout');
      }
      throw new NewApiBridgeError(
        error instanceof Error ? error.message : String(error),
        503,
        'bridge_unavailable',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
