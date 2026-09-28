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
  mocks.account = undefined;
  mocks.accountLoading = false;
  mocks.binding = undefined;
  mocks.bindingLoading = false;
  mocks.useAccountSummary.mockClear();
});

afterEach(() => {
  cleanup();
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
    expect(screen.getByText('Aihub 余额')).toBeInTheDocument();
    expect(screen.getByText('已用金额')).toBeInTheDocument();
    expect(screen.getByText('请求数')).toBeInTheDocument();
    expect(screen.getByText('¥0.14')).toHaveClass('value');
    expect(screen.getByText('¥0.02')).toHaveClass('value');
    expect(screen.getByText('11')).toHaveClass('value');
    expect(screen.queryByText(/[宸鏈鐢浣楼]/)).not.toBeInTheDocument();
    expect(mocks.useAccountSummary).toHaveBeenCalledWith(true);
  });

  it('does not request account balance until the Aihub binding exists', () => {
    mocks.binding = { isBound: false, status: 'missing' };

    render(<NewApiBalance />);

    expect(screen.getByText('未绑定')).toHaveAttribute('data-color', 'warning');
    expect(mocks.useAccountSummary).toHaveBeenCalledWith(false);
    expect(screen.getAllByTestId('balance-loading')).toHaveLength(3);
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
  ['en-US', 'Aihub balance'],
  ['zh-CN', 'Aihub 余额'],
  ['vi-VN', 'Số dư Aihub'],
])('renders balance in %s', async (lang, label) => {
  await i18n.changeLanguage(lang);
  render(<NewApiBalance />);
  expect(screen.getByText(label)).toBeInTheDocument();
});
