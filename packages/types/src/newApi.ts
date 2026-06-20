export type NewApiBindingSyncStatus = 'pending' | 'active' | 'error' | 'missing';

export interface NewApiBindingStatus {
  errorMessage?: string | null;
  isBound: boolean;
  lastSyncedAt?: Date | null;
  managedTokenId?: number | null;
  managedTokens?: NewApiManagedTokenOption[];
  newApiUserId?: number;
  status: NewApiBindingSyncStatus;
}

export interface NewApiManagedTokenOption {
  id: number;
  name: string;
}

export interface NewApiAccountSummary {
  email?: string;
  group?: string;
  newApiUserId: number;
  quotaPolicy?: NewApiQuotaPolicy;
  quota?: number;
  requestCount?: number;
  usedQuota?: number;
  username?: string;
}

export interface NewApiQuotaPolicy {
  quotaDisplayType: 'CNY' | 'USD';
  quotaPerUnit: number;
  usdExchangeRate: number;
}

export interface NewApiTokenUsage {
  expiresAt?: number | null;
  modelLimits?: Record<string, boolean>;
  modelLimitsEnabled?: boolean;
  name?: string;
  object?: string;
  totalAvailable?: number;
  totalGranted?: number;
  totalUsed?: number;
  unlimitedQuota?: boolean;
}

export interface NewApiUsageLogItem {
  completionTokens: number;
  createdAt: number;
  id: number;
  modelName?: string;
  promptTokens: number;
  quota: number;
  requestId?: string;
  tokenName?: string;
  totalTokens: number;
}

export interface NewApiUsageSummary {
  account: NewApiAccountSummary;
  byDay: Record<
    string,
    {
      completionTokens: number;
      promptTokens: number;
      quota: number;
      requests: number;
      totalTokens: number;
    }
  >;
  byModel: Record<
    string,
    {
      completionTokens: number;
      promptTokens: number;
      quota: number;
      requests: number;
      totalTokens: number;
    }
  >;
  recentLogs: NewApiUsageLogItem[];
  requestCount: number;
  quotaPolicy?: NewApiQuotaPolicy;
  tokenUsage: NewApiTokenUsage;
  totalCompletionTokens: number;
  totalPromptTokens: number;
  totalQuota: number;
  totalTokens: number;
}

export interface NewApiBindingImportRow {
  email?: string;
  lobeUserId?: string;
  newApiAccessToken?: string;
  newApiUserId?: number;
  username?: string;
}

export interface NewApiBindingImportResult {
  error?: string;
  lobeUserId?: string;
  newApiUserId?: number;
  ok: boolean;
  source?: 'admin-api' | 'direct-token' | 'readonly-db';
}
