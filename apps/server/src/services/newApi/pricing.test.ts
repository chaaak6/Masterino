// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  type AihubPricingContext,
  buildAihubPricing,
  parseAihubTariff,
  resolveAihubDisplayPricing,
} from './pricing';

const context = (row: AihubPricingContext['response']['data'][number]): AihubPricingContext => ({
  response: { data: [row], group_ratio: { vip: 0.5 } },
  status: { quota_per_unit: 500000, usd_exchange_rate: 7 },
  scope: 'account',
  group: 'vip',
  fetchedAt: '2026-09-08T00:00:00Z',
});
const row = {
  model_name: 'chat',
  quota_type: 0,
  model_ratio: 1,
  completion_ratio: 4,
  cache_ratio: 0.2,
  enable_groups: ['vip'],
};

describe('Aihub tariff projection', () => {
  it.each([undefined, null, 42, {}, []])(
    'skips malformed upstream model names: %j',
    (model_name) => {
      const input = context(row);
      // Runtime JSON can violate the upstream response declaration.
      input.response.data = JSON.parse(JSON.stringify([{ ...row, model_name }, row]));
      expect(buildAihubPricing('CHAT', input).status).toBe('available');
      expect(buildAihubPricing('missing', input).status).toBe('unavailable');
    },
  );
  it('matches model names without changing their suffix or provider identity', () => {
    const mixed = context({ ...row, model_name: 'GLM-5.3' });
    expect(buildAihubPricing('glm-5.3', mixed).status).toBe('available');
    expect(buildAihubPricing('glm-5.3-flash', mixed).status).toBe('unavailable');
  });
  it('converts using the site policy and the effective group, retaining zero rates', () => {
    const result = buildAihubPricing('chat', context({ ...row, cache_ratio: 0 }));
    expect(result.scope).toBe('account');
    expect(result.tiers[0].rates).toEqual({ input: 7, output: 28, cacheRead: 0 });
  });
  it('does not call a public or auto-group price an account tariff', () => {
    expect(buildAihubPricing('chat', { ...context(row), scope: 'public' }).scope).toBe('public');
    const result = buildAihubPricing('chat', { ...context(row), group: 'auto' });
    expect(result.scope).toBe('public');
    expect(result.groupRatio).toBeUndefined();
    expect(result.tiers[0].rates.input).toBe(14);
  });
  it('does not invent a currency conversion or zero price when metadata is missing', () => {
    expect(buildAihubPricing('missing', context(row)).status).toBe('unavailable');
    expect(buildAihubPricing('chat', { ...context(row), status: {} }).status).toBe('unavailable');
    expect(buildAihubPricing('chat', context({ ...row, model_ratio: -1 })).status).toBe(
      'unsupported',
    );
    expect(
      buildAihubPricing('chat', context({ ...row, model_ratio: 0 })).tiers[0].rates.input,
    ).toBe(0);
  });
  it('preserves per-request billing units', () => {
    const result = buildAihubPricing('chat', context({ ...row, quota_type: 1, model_price: 0.1 }));
    expect(result.tiers[0].rates.request).toBeCloseTo(0.35);
    expect(result.tiers[0].rates.input).toBeUndefined();
  });
  it('uses expression dollar coefficients instead of the simultaneously published ratio', () => {
    const result = buildAihubPricing(
      'chat',
      context({
        ...row,
        model_ratio: 37.5,
        billing_mode: 'tiered_expr',
        billing_expr:
          '((hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12) || (hour("Asia/Shanghai") >= 14 && hour("Asia/Shanghai") < 18)) ? tier("peak", p * 0.4 + c * 1.2 + cr * 0.01) : tier("off", p * 0.2 + c * 0.6 + cr * 0.005)',
      }),
    );
    expect(result.status).toBe('available');
    expect(result.tiers[0].rates.input).toBeCloseTo(1.4);
    expect(result.tiers[0].when).toEqual({
      timezone: 'Asia/Shanghai',
      hours: [
        [9, 12],
        [14, 18],
      ],
      outsideHours: false,
    });
    expect(result.tiers[1].when?.outsideHours).toBe(true);
  });
  it('projects the actual reachable context ranges and flags a broken upstream tier', () => {
    const parsed = parseAihubTariff(
      'len <= 512000 ? tier("short", p * 0.3 + c * 6) : len < 200000 ? tier("unreachable", p * 0.6) : tier("fallback", p * 0.6 + c * 2.4)',
    );
    expect(parsed.unreachableTier).toBe(true);
    expect(parsed.tiers.map((t) => t.name)).toEqual(['short', 'fallback']);
    expect(parsed.tiers[0].when?.maxContext).toBe(512000);
    expect(parsed.tiers[1].when?.minContext).toBe(512001);
  });
  it.each([
    'p * 1',
    'tier("x", p * -1)',
    'tier("x", p * 1 + p * 2)',
    'tier("x", p * 1)|||when(header("x")) * 2',
    'tier("x", process.exit())',
    'len > 1 ? tier("x", p * 1) : unknown',
  ])('rejects unsupported expressions without executing them: %s', (billing_expr) => {
    const result = buildAihubPricing(
      'chat',
      context({ ...row, billing_mode: 'tiered_expr', billing_expr }),
    );
    expect(result.status).toBe('unsupported');
    expect(result.tiers).toEqual([]);
  });
});

describe('server-side display rates', () => {
  it.each(['available', 'unavailable', 'unsupported', 'stale'] as const)(
    'only returns public display fields for %s snapshots',
    (state) => {
      const snapshot = {
        ...buildAihubPricing('chat', context(row)),
        pricingVersion: 'private-version',
        unreachableTier: true,
        ...(state === 'stale' ? { stale: true } : { status: state }),
      };
      const display = resolveAihubDisplayPricing(snapshot)!;
      expect(Object.keys(display).sort()).toEqual([
        'currency',
        'displayRates',
        'stale',
        'status',
        'version',
      ]);
      expect(snapshot.tiers.length).toBeGreaterThan(0);
      expect(snapshot.group).toBe('vip');
    },
  );
  it('uses Shanghai time and removes all conditions from the displayed rates', () => {
    const snapshot = buildAihubPricing(
      'chat',
      context({
        ...row,
        billing_mode: 'tiered_expr',
        billing_expr:
          'hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 ? tier("peak", p * 2) : tier("off", p * 1)',
      }),
    );
    const peak = resolveAihubDisplayPricing(snapshot, new Date('2026-09-08T01:00:00Z'))!;
    const off = resolveAihubDisplayPricing(snapshot, new Date('2026-09-08T04:00:00Z'))!;
    expect(peak.displayRates?.input).toEqual({ min: 7, max: 7 });
    expect(off.displayRates?.input).toEqual({ min: 3.5, max: 3.5 });
    expect(peak).not.toHaveProperty('tiers');
  });
  it('shows a range when context tiers differ and does not advertise a rate missing in one tier', () => {
    const snapshot = buildAihubPricing(
      'chat',
      context({
        ...row,
        billing_mode: 'tiered_expr',
        billing_expr: 'len <= 512000 ? tier("short", p * 1 + cr * 0) : tier("long", p * 2)',
      }),
    );
    expect(resolveAihubDisplayPricing(snapshot)?.displayRates).toEqual({
      input: { min: 3.5, max: 7 },
    });
    expect(resolveAihubDisplayPricing({ ...snapshot, stale: true })?.displayRates).toBeUndefined();
  });
});
