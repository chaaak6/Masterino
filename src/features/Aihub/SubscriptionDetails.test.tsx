import type { NewApiSubscription, NewApiSubscriptionSummary } from '@lobechat/types';
import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import zh from '@/../locales/zh-CN/aihub.json';

import SubscriptionDetails from './SubscriptionDetails';

const i18n = createInstance();
const subscription: NewApiSubscription = {
  id: 1,
  title: '每月额度、年度有效期',
  status: 'active',
  amountTotal: 50_000_000,
  amountUsed: 7_685_000,
  startTime: Date.parse('2026-09-30T00:00:00+08:00') / 1000,
  endTime: Date.parse('2027-09-30T00:00:00+08:00') / 1000,
  nextResetTime: Date.parse('2026-11-01T00:00:00+08:00') / 1000,
  resetAmount: 50_000_000,
  allowWalletOverflow: true,
};
const summary: NewApiSubscriptionSummary = {
  billingPreference: 'subscription_first',
  subscriptions: [subscription],
};
const show = (data?: NewApiSubscriptionSummary, error?: unknown, loading = false) =>
  render(
    <I18nextProvider i18n={i18n}>
      <SubscriptionDetails
        data={data}
        error={error}
        loading={loading}
        quotaPolicy={{ quotaDisplayType: 'CNY', quotaPerUnit: 500_000, usdExchangeRate: 7 }}
      />
    </I18nextProvider>,
  );

beforeAll(async () => {
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { aihub: zh } } });
});
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-07T04:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SubscriptionDetails user-visible behavior', () => {
  it('given an annual subscription, shows monthly quota separately from expiry', () => {
    show(summary);
    expect(screen.getByText('¥592.41')).toBeInTheDocument();
    expect(screen.getByText('¥107.59')).toBeInTheDocument();
    expect(screen.getByText('2026/11/01 00:00')).toBeInTheDocument();
    expect(screen.getByText(/订阅有效期至 2027\/09\/30/)).toBeInTheDocument();
    expect(screen.getByText('重置为 ¥700.00')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '已用 ¥107.59 / ¥700.00');
    expect(screen.getByRole('link', { name: '管理订阅' })).toHaveAttribute(
      'href',
      'https://aihub.bielcrystal.com/',
    );
  });

  it.each([
    ['no subscription', [], false],
    ['expired subscription', [{ ...subscription, endTime: 1 }], true],
  ] as const)('given %s, offers activation', (_, subscriptions, expired) => {
    show({ ...summary, subscriptions: [...subscriptions] });
    expect(screen.getByText('暂无有效订阅')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '开通订阅' })).toHaveAttribute('target', '_blank');
    expect(!!screen.queryByText('已到期')).toBe(expired);
  });

  it.each([
    ['loading', undefined, true, '正在读取订阅…'],
    ['failed read', new Error('Unavailable'), false, '订阅信息暂时无法获取'],
  ] as const)(
    'given %s, does not claim the account has no subscription',
    (_, error, loading, message) => {
      show(undefined, error, loading);
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: '开通订阅' })).not.toBeInTheDocument();
      expect(screen.queryByText('暂无有效订阅')).not.toBeInTheDocument();
    },
  );

  it.each([
    [{ amountUsed: 50_000_000 }, '本期额度已用尽'],
    [{ nextResetTime: subscription.startTime }, '额度重置待更新'],
    [{ amountTotal: 0 }, '订阅额度不限'],
  ] as const)('given changed quota state, shows %s', (change, expected) => {
    show({ ...summary, subscriptions: [{ ...subscription, ...change }] });
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByText('重置为 ¥700.00')).toBeInTheDocument();
  });

  it('given two subscriptions, keeps their reset amounts and actual billing preference', () => {
    show({
      billingPreference: 'wallet_first',
      subscriptions: [subscription, { ...subscription, id: 2, resetAmount: 10_000_000 }],
    });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('重置为 ¥700.00')).toBeInTheDocument();
    expect(screen.getByText('重置为 ¥140.00')).toBeInTheDocument();
    expect(screen.getByText(/钱包优先/)).toBeInTheDocument();
    expect(screen.queryByText('订阅额度不足时允许使用钱包')).not.toBeInTheDocument();
  });
});
