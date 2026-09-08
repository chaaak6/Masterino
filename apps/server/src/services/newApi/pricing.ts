import type { AihubModelPricing, AihubPriceTier, AihubPriceUnit } from 'model-bank';

import type { NewApiPricingResponse, NewApiStatus } from './client';

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const nonnegative = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;
const variables: Record<string, AihubPriceUnit> = {
  p: 'input',
  c: 'output',
  cr: 'cacheRead',
  cc: 'cacheWrite',
};
type When = NonNullable<AihubPriceTier['when']>;

/** Find a top-level operator without interpreting any upstream code. */
const topLevel = (text: string, char: string) => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && c === char) return i;
  }
  return -1;
};

/** Deliberately bounded grammar: linear token tariffs, context tiers and hour ranges.
 * Other valid Aihub expressions remain conditional/unknown, never guessed or eval'd.
 */
export const parseAihubTariff = (
  expression: string,
): { tiers: AihubPriceTier[]; unreachableTier: boolean } => {
  if (expression.length > 12000) throw new Error('Expression too long');
  let unreachableTier = false;
  const parse = (raw: string, when: When = {}, depth = 0): AihubPriceTier[] => {
    if (depth > 16) throw new Error('Too many tiers');
    const text = raw.trim();
    const question = topLevel(text, '?');
    if (question < 0) {
      const match = /^tier\(\s*("(?:[^"\\]|\\.)*")\s*,(.*)\)$/s.exec(text);
      if (!match) throw new Error('Unsupported tariff');
      const rates: AihubPriceTier['rates'] = {};
      for (const term of match[2].split('+')) {
        const value = /^\s*(p|c|cr|cc)\s*\*\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*$/i.exec(term);
        if (!value || !nonnegative(Number(value[2]))) throw new Error('Unsupported rate');
        const key = variables[value[1]];
        if (!key || rates[key] !== undefined) throw new Error('Duplicate rate');
        rates[key] = Number(value[2]);
      }
      if (
        when.minContext !== undefined &&
        when.maxContext !== undefined &&
        when.minContext > when.maxContext
      ) {
        unreachableTier = true;
        return [];
      }
      return [{ name: JSON.parse(match[1]), rates, ...(Object.keys(when).length ? { when } : {}) }];
    }
    const condition = text.slice(0, question).trim();
    const rest = text.slice(question + 1);
    const colon = topLevel(rest, ':');
    if (colon < 0) throw new Error('Missing fallback');
    const yes = rest.slice(0, colon);
    const no = rest.slice(colon + 1);
    const context = /^len\s*(<=|<|>=|>)\s*(\d+)$/.exec(condition);
    if (context) {
      const bound = Number(context[2]);
      if (!Number.isSafeInteger(bound)) throw new Error('Invalid boundary');
      const less = context[1].startsWith('<');
      const lowerMax = bound - (context[1] === '<' || context[1] === '>=' ? 1 : 0);
      const low = {
        ...when,
        minContext: when.minContext ?? 0,
        maxContext: Math.min(when.maxContext ?? Infinity, lowerMax),
      };
      const high = { ...when, minContext: Math.max(when.minContext ?? 0, lowerMax + 1) };
      return [
        ...parse(yes, less ? low : high, depth + 1),
        ...parse(no, less ? high : low, depth + 1),
      ];
    }
    // Canonical hour ranges: (hour("Zone") >= A && hour("Zone") < B) || ...
    const compact = condition.replaceAll(/\s/g, '');
    const hourPattern = /hour\("([A-Za-z_+\-/]+)"\)>=(\d+)&&hour\("\1"\)<(\d+)/g;
    const matches = [...compact.matchAll(hourPattern)];
    const residue = compact.replaceAll(hourPattern, '').replaceAll(/[()|]/g, '');
    // Reconstruct the accepted boolean shape; don't accept adjacent ranges or && between ranges.
    const shape = compact.replaceAll(hourPattern, 'R').replaceAll(/[()]/g, '');
    if (residue || !/^R(?:\|\|R)*$/.test(shape) || when.hours)
      throw new Error('Unsupported condition');
    const timezone = matches[0]?.[1];
    if (!timezone || matches.some((m) => m[1] !== timezone)) throw new Error('Mixed timezone');
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    const hours = matches.map((m): [number, number] => [Number(m[2]), Number(m[3])]);
    if (hours.some(([start, end]) => start < 0 || end > 24 || start >= end))
      throw new Error('Invalid hours');
    return [
      ...parse(yes, { ...when, timezone, hours, outsideHours: false }, depth + 1),
      ...parse(no, { ...when, timezone, hours, outsideHours: true }, depth + 1),
    ];
  };
  const tiers = parse(expression.replace(/^v1:/, ''));
  return { tiers, unreachableTier };
};

export interface AihubPricingContext {
  fetchedAt: string;
  group?: string;
  response: NewApiPricingResponse;
  scope: 'account' | 'public';
  status: NewApiStatus;
}

export const buildAihubPricing = (
  modelId: string,
  context: AihubPricingContext,
): AihubModelPricing => {
  const { response, status, fetchedAt } = context;
  const row = response.data?.find((item) => item.model_name === modelId);
  const group = context.group && context.group !== 'auto' ? context.group : undefined;
  const ratio = group ? response.group_ratio?.[group] : undefined;
  const knownRatio =
    nonnegative(ratio) && row?.enable_groups?.some((g) => g === group || g === 'all');
  const effective = context.scope === 'account' && !!knownRatio;
  const multiplier = knownRatio ? ratio : 1;
  const snapshot: AihubModelPricing = {
    version: 1,
    source: 'aihub',
    currency: 'CNY',
    fetchedAt,
    scope: effective ? 'account' : 'public',
    ...(knownRatio ? { group, groupRatio: multiplier } : {}),
    pricingVersion: row?.pricing_version ?? response.pricing_version,
    status: 'unavailable',
    tiers: [],
  };
  if (!row || !positive(status.usd_exchange_rate) || !positive(status.quota_per_unit))
    return snapshot;
  snapshot.exchangeRate = status.usd_exchange_rate;
  let tiers: AihubPriceTier[];
  if (row.billing_mode === 'tiered_expr') {
    try {
      const parsed = parseAihubTariff(row.billing_expr ?? '');
      tiers = parsed.tiers;
      snapshot.unreachableTier = parsed.unreachableTier || undefined;
    } catch {
      return { ...snapshot, status: 'unsupported' };
    }
  } else if (row.billing_mode && row.billing_mode !== 'ratio') {
    return { ...snapshot, status: 'unsupported' };
  } else if (row.quota_type === 1 && nonnegative(row.model_price)) {
    tiers = [{ rates: { request: row.model_price } }];
  } else if (row.quota_type === 0 && nonnegative(row.model_ratio)) {
    const input = (row.model_ratio * 1_000_000) / status.quota_per_unit;
    const rates: AihubPriceTier['rates'] = { input };
    if (nonnegative(row.completion_ratio)) rates.output = input * row.completion_ratio;
    if (nonnegative(row.cache_ratio)) rates.cacheRead = input * row.cache_ratio;
    if (nonnegative(row.create_cache_ratio)) rates.cacheWrite = input * row.create_cache_ratio;
    tiers = [{ rates }];
  } else {
    return { ...snapshot, status: 'unsupported' };
  }
  snapshot.tiers = tiers.map((tier) => ({
    ...tier,
    rates: Object.fromEntries(
      Object.entries(tier.rates).map(([key, rate]) => [
        key,
        rate! * status.usd_exchange_rate! * multiplier,
      ]),
    ),
  }));
  if (
    !snapshot.tiers.length ||
    snapshot.tiers.some((tier) => Object.values(tier.rates).some((rate) => !nonnegative(rate)))
  ) {
    return { ...snapshot, tiers: [], status: 'unsupported' };
  }
  return { ...snapshot, status: 'available' };
};

/** Resolve time conditions on the server; the picker receives only current price ranges. */
export const resolveAihubDisplayPricing = (
  pricing: AihubModelPricing | undefined,
  now = new Date(),
): AihubModelPricing | undefined => {
  if (!pricing) return undefined;
  const result: AihubModelPricing = { ...pricing, tiers: [], displayRates: undefined };
  if (pricing.stale || pricing.status !== 'available') return result;
  try {
    const tiers = pricing.tiers.filter(({ when }) => {
      if (!when?.hours) return true;
      const hour = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: when.timezone,
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(now),
      );
      const inside = when.hours.some(([start, end]) => hour >= start && hour < end);
      return when.outsideHours ? !inside : inside;
    });
    const displayRates: NonNullable<AihubModelPricing['displayRates']> = {};
    for (const unit of ['input', 'output', 'cacheRead', 'cacheWrite', 'request'] as const) {
      const rates = tiers.map((tier) => tier.rates[unit]);
      if (!rates.length || !rates.every(nonnegative)) continue;
      displayRates[unit] = { min: Math.min(...rates), max: Math.max(...rates) };
    }
    return { ...result, displayRates };
  } catch {
    return { ...result, status: 'unavailable' };
  }
};
