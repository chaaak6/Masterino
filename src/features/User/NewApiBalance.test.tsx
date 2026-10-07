import type { NewApiSubscriptionSummary } from '@lobechat/types';
import { cleanup, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import type { ReactNode } from 'react';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/../locales/en-US/aihub.json';
import viVN from '@/../locales/vi-VN/aihub.json';
import zh from '@/../locales/zh-CN/aihub.json';

import NewApiBalance from './NewApiBalance';

const mocks = vi.hoisted(() => ({
  account: undefined as any,
  accountLoading: false,
  binding: undefined as any,
  bindingLoading: false,
  subscription: undefined as NewApiSubscriptionSummary | undefined,
  useAccountSummary: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Tag: ({ children, color }: { children: ReactNode; color?: string }) => (
    <span data-color={color}>{children}</span>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    card: 'card',
    label: 'label',
    row: 'row',
    value: 'value',
  }),
}));

vi.mock('@/components/NeuralNetworkLoading', () => ({
  default: () => <span data-testid="balance-loading" />,
}));

vi.mock('@/store/newApi', () => ({
  useNewApiSubscriptionSummary: () => ({
    data: mocks.subscription,
  }),
  useNewApiAccountSummary: (enabled: boolean) => {
    mocks.useAccountSummary(enabled);

    return {
      data: enabled ? mocks.account : undefined,
      isLoading: mocks.accountLoading,
    };
  },
  useNewApiBindingStatus: () => ({
    data: mocks.binding,
    isLoading: mocks.bindingLoading,
  }),
}));

beforeEach(() => {
  mocks.subscription = { billingPreference: 'subscription_first', subscriptions: [] };
  mocks.account = undefined;
  mocks.accountLoading = false;
  mocks.binding = undefined;
  mocks.bindingLoading = false;
  mocks.useAccountSummary.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NewApiBalance', () => {
  it('renders active Aihub balance as RMB rows without mojibake text', () => {
    mocks.binding = { isBound: true, status: 'active' };
    mocks.account = {
      quota: 10_000,
      quotaPolicy: {
        quotaDisplayType: 'CNY',
        quotaPerUnit: 500_000,
        usdExchangeRate: 7.12,
      },
      requestCount: 11,
      usedQuota: 1_250,
    };

    render(<NewApiBalance />);

    expect(screen.getByText('已绑定')).toHaveAttribute('data-color', 'success');
    expect(screen.getByText('钱包余额')).toBeInTheDocument();
    expect(screen.getByText('累计已用金额')).toBeInTheDocument();
    expect(screen.queryByText('请求数')).not.toBeInTheDocument();
    expect(screen.getByText('¥0.14')).toHaveClass('value');
    expect(screen.getByText('¥0.02')).toHaveClass('value');
    expect(screen.queryByText(/[宸鏈鐢浣楼]/)).not.toBeInTheDocument();
    expect(mocks.useAccountSummary).toHaveBeenCalledWith(true);
  });

  it('shows subscription remainder and reset alongside wallet and cumulative spending', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-07T04:00:00Z'));
    mocks.binding = { isBound: true, status: 'active' };
    mocks.account = {
      quota: 50_000_000,
      usedQuota: 7_685_000,
      quotaPolicy: { quotaDisplayType: 'CNY', quotaPerUnit: 500_000, usdExchangeRate: 7 },
    };
    mocks.subscription = {
      billingPreference: 'subscription_first',
      subscriptions: [
        {
          id: 1,
          title: 'Monthly quota',
          status: 'active',
          amountTotal: 50_000_000,
          amountUsed: 7_685_000,
          startTime: 0,
          endTime: 0,
          nextResetTime: 1793462400,
          resetAmount: 50_000_000,
          allowWalletOverflow: true,
        },
      ],
    };
    render(<NewApiBalance />);
    expect(screen.getByText('订阅剩余额度').parentElement).toHaveTextContent('¥592.41');
    expect(screen.getByText('钱包余额').parentElement).toHaveTextContent('¥700.00');
    expect(screen.getByText('累计已用金额').parentElement).toHaveTextContent('¥107.59');
    expect(screen.getByText('2026/11/01 00:00')).toBeInTheDocument();
    expect(screen.getByText('重置为 ¥700.00')).toBeInTheDocument();
  });

  it('does not request account balance until the Aihub binding exists', () => {
    mocks.binding = { isBound: false, status: 'missing' };

    render(<NewApiBalance />);

    expect(screen.getByText('未绑定')).toHaveAttribute('data-color', 'warning');
    expect(mocks.useAccountSummary).toHaveBeenCalledWith(false);
    expect(screen.getAllByTestId('balance-loading')).toHaveLength(2);
  });
});

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh-CN',
    fallbackLng: 'en-US',
    keySeparator: false,
    defaultNS: 'aihub',
    resources: { 'en-US': { aihub: en }, 'zh-CN': { aihub: zh }, 'vi-VN': { aihub: viVN } },
    showSupportNotice: false,
  });
});

it.each([
  ['en-US', 'Wallet balance'],
  ['zh-CN', '钱包余额'],
  ['vi-VN', 'Số dư ví'],
])('renders balance in %s', async (lang, label) => {
  await i18n.changeLanguage(lang);
  render(<NewApiBalance />);
  expect(screen.getByText(label)).toBeInTheDocument();
});
