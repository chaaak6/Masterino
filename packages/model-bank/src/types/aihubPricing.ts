/** Aihub tariff data. Never used to settle a bill. */
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
export interface AihubDisplayPricing {
  currency: 'CNY';
  displayRates?: Partial<Record<AihubPriceUnit, { min: number; max: number }>>;
  stale?: boolean;
  status: 'available' | 'unavailable' | 'unsupported';
  version: 1;
}

/** Stored server-side snapshot; project to AihubDisplayPricing before returning to clients. */
export interface AihubModelPricing extends AihubDisplayPricing {
  exchangeRate?: number;
  fetchedAt: string;
  group?: string;
  groupRatio?: number;
  pricingVersion?: string;
  scope: 'account' | 'public';
  source: 'aihub';
  tiers: AihubPriceTier[];
  /** An upstream context tier is unreachable; do not silently advertise it. */
  unreachableTier?: boolean;
}
