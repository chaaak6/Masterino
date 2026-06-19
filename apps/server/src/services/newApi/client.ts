export interface NewApiManagementAuth {
  accessToken: string;
  newApiUserId: number;
}

export interface NewApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface NewApiUserSelf {
  email?: string;
  display_name?: string;
  group?: string;
  id: number;
  quota?: number;
  request_count?: number;
  used_quota?: number;
  username?: string;
}

export interface NewApiStatus {
  quota_display_type?: string;
  quota_per_unit?: number;
  usd_exchange_rate?: number;
}

export type NewApiUser = NewApiUserSelf & {
  role?: number;
  status?: number;
};

export type NewApiCreateUserInput = {
  display_name?: string;
  email?: string;
  group?: string;
  name?: string;
  quota?: number;
  username: string;
  userGroup?: string;
};

export interface NewApiToken {
  expired_time?: number;
  id: number;
  key?: string;
  model_limits?: string;
  model_limits_enabled?: boolean;
  name: string;
  remain_quota?: number;
  status?: number;
  unlimited_quota?: boolean;
  user_id?: number;
  used_quota?: number;
}

export interface NewApiTokenUsageResponse {
  expires_at?: number;
  model_limits?: Record<string, boolean>;
  model_limits_enabled?: boolean;
  name?: string;
  object?: string;
  total_available?: number;
  total_granted?: number;
  total_used?: number;
  unlimited_quota?: boolean;
}

export interface NewApiModelCard {
  created?: number;
  id: string;
  object?: string;
  owned_by?: string;
  supported_endpoint_types?: string[];
}

export interface NewApiLogItem {
  completion_tokens?: number;
  created_at: number;
  id: number;
  model_name?: string;
  prompt_tokens?: number;
  quota?: number;
  request_id?: string;
  token_name?: string;
}

export interface NewApiPage<T> {
  items: T[];
  page?: number;
  page_size?: number;
  total?: number;
}

export class NewApiError extends Error {
  body?: unknown;
  status: number;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'NewApiError';
    this.status = status;
    this.body = body;
  }
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

const normalizeTokenKey = (tokenKey: string) =>
  tokenKey.startsWith('sk-') ? tokenKey : `sk-${tokenKey}`;

const readErrorMessage = (body: unknown, fallback: string) => {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = record.message || record.error || record.msg;
    if (typeof message === 'string' && message.trim()) return message;

    if (record.error && typeof record.error === 'object') {
      const nestedMessage = (record.error as Record<string, unknown>).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage;
    }
  }

  return fallback;
};

const unwrapNewApiBody = <T>(body: unknown, status: number): T => {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (record.success === false || record.code === false) {
      throw new NewApiError(readErrorMessage(body, 'Aihub request failed'), status, body);
    }

    if ('data' in record) return record.data as T;
  }

  return body as T;
};

export class NewApiClient {
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor({ baseUrl, fetchImpl = fetch, timeoutMs = 30_000 }: NewApiClientOptions) {
    if (!baseUrl) throw new Error('AIHUB_PROXY_URL is required');

    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  private managementHeaders(auth: NewApiManagementAuth) {
    return {
      Authorization: `Bearer ${auth.accessToken}`,
      'New-Api-User': String(auth.newApiUserId),
    };
  }

  private tokenHeaders(tokenKey: string) {
    return {
      Authorization: `Bearer ${normalizeTokenKey(tokenKey)}`,
    };
  }

  private buildUrl(path: string, query?: Record<string, number | string | undefined>) {
    const url = new URL(path, `${this.baseUrl}/`);

    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  private async request<T>(
    path: string,
    init: RequestInit & {
      auth?: NewApiManagementAuth;
      query?: Record<string, number | string | undefined>;
      tokenKey?: string;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(init.auth ? this.managementHeaders(init.auth) : {}),
      ...(init.tokenKey ? this.tokenHeaders(init.tokenKey) : {}),
      ...(init.headers as Record<string, string> | undefined),
    };

    if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    try {
      const response = await this.fetchImpl(this.buildUrl(path, init.query), {
        ...init,
        headers,
        method: init.method || 'GET',
        signal: init.signal || controller.signal,
      });

      const text = await response.text();
      const body = text ? JSON.parse(text) : undefined;

      if (!response.ok) {
        throw new NewApiError(
          readErrorMessage(body, `Aihub request failed with ${response.status}`),
          response.status,
          body,
        );
      }

      return unwrapNewApiBody<T>(body, response.status);
    } catch (error) {
      if (error instanceof NewApiError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new NewApiError('Aihub request timed out', 408);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  getSelf(auth: NewApiManagementAuth) {
    return this.request<NewApiUserSelf>('/api/user/self', { auth });
  }

  getStatus() {
    return this.request<NewApiStatus>('/api/status');
  }

  searchUsers(
    auth: NewApiManagementAuth,
    {
      keyword,
      page = 1,
      pageSize = 100,
    }: { keyword: string; page?: number; pageSize?: number },
  ) {
    return this.request<NewApiPage<NewApiUser>>('/api/user/search', {
      auth,
      query: {
        keyword,
        p: page,
        size: pageSize,
      },
    });
  }

  createUser(auth: NewApiManagementAuth, input: NewApiCreateUserInput) {
    return this.request<NewApiUser>('/api/user/', {
      auth,
      body: JSON.stringify(input),
      method: 'POST',
    });
  }

  createToken(auth: NewApiManagementAuth, input: Partial<NewApiToken>) {
    return this.request<NewApiToken>('/api/token/', {
      auth,
      body: JSON.stringify(input),
      method: 'POST',
    });
  }

  getTokenKey(auth: NewApiManagementAuth, tokenId: number) {
    return this.request<{ key: string }>(`/api/token/${tokenId}/key`, { auth, method: 'POST' });
  }

  getTokenUsage(tokenKey: string) {
    return this.request<NewApiTokenUsageResponse>('/api/usage/token/', { tokenKey });
  }

  listModels(tokenKey: string) {
    return this.request<NewApiModelCard[]>('/v1/models', { tokenKey });
  }

  listTokens(
    auth: NewApiManagementAuth,
    {
      keyword,
      page = 1,
      pageSize = 100,
    }: { keyword?: string; page?: number; pageSize?: number } = {},
  ) {
    return this.request<NewApiPage<NewApiToken>>(keyword ? '/api/token/search' : '/api/token/', {
      auth,
      query: {
        keyword,
        p: page,
        size: pageSize,
      },
    });
  }

  getSelfLogs(
    auth: NewApiManagementAuth,
    params: {
      endTimestamp?: number;
      modelName?: string;
      page?: number;
      pageSize?: number;
      startTimestamp?: number;
      tokenName?: string;
      type?: number;
    } = {},
  ) {
    return this.request<NewApiPage<NewApiLogItem>>('/api/log/self', {
      auth,
      query: {
        end_timestamp: params.endTimestamp,
        model_name: params.modelName,
        p: params.page ?? 1,
        page_size: params.pageSize ?? 100,
        start_timestamp: params.startTimestamp,
        token_name: params.tokenName,
        type: params.type ?? 2,
      },
    });
  }
}
