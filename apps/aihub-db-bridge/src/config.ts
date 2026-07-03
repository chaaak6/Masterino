export interface BridgeConfig {
  bridgeToken: string;
  connectionString: string;
  iamProviderId: number;
  managedTokenName: string;
  port: number;
  queryTimeoutMs: number;
}

const readRequired = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);

  return value;
};

const readPositiveInteger = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
};

export const loadConfig = (): BridgeConfig => ({
  bridgeToken: readRequired('AIHUB_BRIDGE_TOKEN'),
  connectionString: readRequired('AIHUB_READONLY_DATABASE_URL'),
  iamProviderId: readPositiveInteger('AIHUB_IAM_PROVIDER_ID', 1),
  managedTokenName: process.env.AIHUB_MANAGED_TOKEN_NAME || 'masterlion-managed',
  port: readPositiveInteger('PORT', 3218),
  queryTimeoutMs: readPositiveInteger('AIHUB_QUERY_TIMEOUT_MS', 15_000),
});
