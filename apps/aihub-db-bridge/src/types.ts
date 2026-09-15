export interface AihubBridgeUser {
  display_name?: string;
  email?: string;
  group?: string;
  id: number;
  quota?: number;
  request_count?: number;
  role?: number;
  status?: number;
  used_quota?: number;
  username?: string;
}

export interface AihubBridgeToken {
  allow_ips?: string;
  expired_time?: number;
  group?: string;
  id: number;
  key?: string;
  model_limits?: string;
  model_limits_enabled?: boolean;
  name: string;
  remain_quota?: number;
  status?: number;
  unlimited_quota?: boolean;
  used_quota?: number;
  user_id?: number;
}

export type BoundTokenAvailability =
  | 'active'
  | 'disabled'
  | 'expired'
  | 'exhausted'
  | 'deleted'
  | 'missing'
  | 'owner_mismatch';

/** Management view of exactly one bound token. Never includes its API key. */
export interface BoundTokenInspection {
  availability: BoundTokenAvailability;
  token?: Omit<AihubBridgeToken, 'key'>;
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

export interface AihubBridgeUsageLog {
  completion_tokens?: number;
  created_at: number;
  id: number;
  model_name?: string;
  prompt_tokens?: number;
  quota?: number;
  request_id?: string;
  token_name?: string;
}

export interface AihubBridgePage<T> {
  items: T[];
  total?: number;
}

export interface AihubBridgeSuccess<T> {
  data: T;
  success: true;
}

export interface AihubBridgeFailure {
  error: {
    code: string;
    message: string;
  };
  success: false;
}

export type AihubOAuthBindingConflictReason = 'provider_user_id_in_use' | 'user_already_bound';

export type AihubOAuthBindingResult =
  | { status: 'created' | 'existing' | 'repaired' }
  | { status: 'missing' }
  | { reason: AihubOAuthBindingConflictReason; status: 'conflict' };
