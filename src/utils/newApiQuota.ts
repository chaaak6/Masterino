import type { NewApiQuotaPolicy } from '@lobechat/types';

const DEFAULT_QUOTA_POLICY: NewApiQuotaPolicy = {
  quotaDisplayType: 'CNY',
  quotaPerUnit: 500_000,
  usdExchangeRate: 7.12,
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const normalizePolicy = (policy?: NewApiQuotaPolicy): NewApiQuotaPolicy => ({
  quotaDisplayType: policy?.quotaDisplayType === 'USD' ? 'USD' : DEFAULT_QUOTA_POLICY.quotaDisplayType,
  quotaPerUnit:
    policy?.quotaPerUnit && policy.quotaPerUnit > 0
      ? policy.quotaPerUnit
      : DEFAULT_QUOTA_POLICY.quotaPerUnit,
  usdExchangeRate:
    policy?.usdExchangeRate && policy.usdExchangeRate > 0
      ? policy.usdExchangeRate
      : DEFAULT_QUOTA_POLICY.usdExchangeRate,
});

export const getNewApiQuotaAmount = (rawQuota?: number | null, policy?: NewApiQuotaPolicy) => {
  if (rawQuota === undefined || rawQuota === null) return undefined;

  const normalized = normalizePolicy(policy);
  const usdAmount = rawQuota / normalized.quotaPerUnit;
  const amount =
    normalized.quotaDisplayType === 'USD' ? usdAmount : usdAmount * normalized.usdExchangeRate;

  return {
    amount: roundMoney(amount),
    currency: normalized.quotaDisplayType,
    rawQuota,
    usdAmount,
  };
};

export const formatNewApiQuota = (rawQuota?: number | null, policy?: NewApiQuotaPolicy) => {
  const amount = getNewApiQuotaAmount(rawQuota, policy);
  if (!amount) return '-';

  return new Intl.NumberFormat('zh-CN', {
    currency: amount.currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(amount.amount);
};
