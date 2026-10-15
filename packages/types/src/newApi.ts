export type AihubOAuthBindingStatus =
  | 'unknown'
  | 'pending'
  | 'active'
  | 'error'
  | 'conflict'
  | 'missing';

export interface AihubOAuthBindingState {
  errorCode?: string | null;
  errorMessage?: string | null;
  lastSyncedAt?: Date | null;
  status: AihubOAuthBindingStatus;
}

export interface AihubRebindResult extends AihubOAuthBindingState {
  repaired: boolean;
}

export type NewApiBindingSyncStatus = 'pending' | 'active' | 'error' | 'missing';
export type AihubReadinessErrorKind =
  | 'configuration'
  | 'transient'
  | 'identity_conflict'
  | 'entitlement'
  | 'permanent';

export interface NewApiBindingStatus {
  errorCode?: string | null;
  errorKind?: AihubReadinessErrorKind | null;
  errorMessage?: string | null;
  isBound: boolean;
  lastSyncedAt?: Date | null;
  managedTokenId?: number | null;
  managedTokens?: NewApiManagedTokenOption[];
  modelCount?: number;
  newApiUserId?: number;
  oauthBinding?: AihubOAuthBindingState;
  readinessVersion?: number;
  retryable?: boolean;
  retryAfterMs?: number;
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
  quota?: number;
  quotaPolicy?: NewApiQuotaPolicy;
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
  quotaPolicy?: NewApiQuotaPolicy;
  recentLogs: NewApiUsageLogItem[];
  requestCount: number;
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

export type NewApiBillingPreference =
  | 'subscription_first'
  | 'wallet_first'
  | 'subscription_only'
  | 'wallet_only';

export interface NewApiSubscription {
  allowWalletOverflow: boolean;
  amountTotal: number;
  amountUsed: number;
  endTime: number;
  id: number;
  nextResetTime: number;
  resetAmount: number;
  startTime: number;
  status: string;
  title: string;
}

export interface NewApiSubscriptionSummary {
  billingPreference: NewApiBillingPreference;
  subscriptions: NewApiSubscription[];
}
