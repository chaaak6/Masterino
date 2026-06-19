import { describe, expect, it } from 'vitest';

import { formatNewApiQuota, getNewApiQuotaAmount } from './newApiQuota';

describe('newApiQuota', () => {
  it('converts NewAPI raw quota into RMB using the Aihub quota policy', () => {
    const amount = getNewApiQuotaAmount(431_425_467, {
      quotaDisplayType: 'CNY',
      quotaPerUnit: 500_000,
      usdExchangeRate: 7.12,
    });

    expect(amount).toMatchObject({
      amount: 6143.5,
      currency: 'CNY',
      rawQuota: 431_425_467,
      usdAmount: 862.850934,
    });
  });

  it('formats quota as an intuitive RMB amount instead of raw quota units', () => {
    expect(
      formatNewApiQuota(10_000, {
        quotaDisplayType: 'CNY',
        quotaPerUnit: 500_000,
        usdExchangeRate: 7.12,
      }),
    ).toBe('¥0.14');
  });
});
