/** Non-secret, display-only Aihub tariff snapshot. Never used to settle a bill. */
export type AihubPriceUnit = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'request';
export interface AihubPriceTier {
  name?: string;
  rates: Partial<Record<AihubPriceUnit, number>>;
  when?: {
    minContext?: number;
    maxContext?: number;
    timezone?: string;
    hours?: [number, number][];
    outsideHours?: boolean;
  };
}
export interface AihubModelPricing {
  currency: 'CNY';
  /** Computed by the server for display; conditions remain backend metadata. */
  displayRates?: Partial<Record<AihubPriceUnit, { min: number; max: number }>>;
  exchangeRate?: number;
  fetchedAt: string;
  group?: string;
  groupRatio?: number;
  pricingVersion?: string;
  scope: 'account' | 'public';
  source: 'aihub';
  stale?: boolean;
  status: 'available' | 'unavailable' | 'unsupported';
  tiers: AihubPriceTier[];
  /** An upstream context tier is unreachable; do not silently advertise it. */
  unreachableTier?: boolean;
  version: 1;
}
