import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Page from './index';

const mocks = vi.hoisted(() => ({
  account: {
    group: 'default',
    quota: 10_000,
    quotaPolicy: {
      quotaDisplayType: 'CNY' as const,
      quotaPerUnit: 500_000,
      usdExchangeRate: 7.12,
    },
    requestCount: 11,
    usedQuota: 1_250,
    username: '10193226',
  },
  binding: {
    isBound: true,
    lastSyncedAt: '2026-06-19T00:00:00.000Z',
    managedTokenId: 13,
    newApiUserId: 6,
    status: 'active',
  },
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  mutateAccount: vi.fn(),
  mutateBinding: vi.fn(),
  mutateUsage: vi.fn(),
  refreshAiModelList: vi.fn(),
  refreshAiProviderDetail: vi.fn(),
  syncModels: vi.fn(),
  usage: {
    quotaPolicy: {
      quotaDisplayType: 'CNY' as const,
      quotaPerUnit: 500_000,
      usdExchangeRate: 7.12,
    },
    tokenUsage: {
      totalAvailable: 8_750,
      unlimitedQuota: false,
    },
    totalCompletionTokens: 20,
    totalPromptTokens: 30,
    totalQuota: 10_000,
    totalTokens: 50,
  },
  useFetchAiProviderItem: vi.fn(),
  useFetchAiProviderList: vi.fn(),
}));

vi.mock('@lobehub/icons', () => ({
  ProviderCombine: ({ provider }: { provider: string }) => <span>{provider}</span>,
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Flexbox: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  FormGroup: ({
    children,
    extra,
    title,
  }: {
    children: ReactNode;
    extra?: ReactNode;
    title?: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {extra}
      {children}
    </section>
  ),
  Tag: ({ children, color }: { children: ReactNode; color?: string }) => (
    <span data-color={color}>{children}</span>
  ),
  Text: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: mocks.messageError,
        success: mocks.messageSuccess,
      },
    }),
  },
  Divider: () => <hr />,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: {
      field: 'field',
      fieldValue: 'fieldValue',
    },
  }),
}));

vi.mock('@/store/aiInfra', () => {
  const state = {
    refreshAiModelList: mocks.refreshAiModelList,
    refreshAiProviderDetail: mocks.refreshAiProviderDetail,
    useFetchAiProviderItem: mocks.useFetchAiProviderItem,
    useFetchAiProviderList: mocks.useFetchAiProviderList,
  };
  const useAiInfraStore = Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state,
  });

  return { useAiInfraStore };
});

vi.mock('@/store/newApi', () => ({
  useNewApiAccountSummary: () => ({ data: mocks.account, mutate: mocks.mutateAccount }),
  useNewApiBindingStatus: () => ({ data: mocks.binding, mutate: mocks.mutateBinding }),
  useNewApiUsageSummary: () => ({ data: mocks.usage, mutate: mocks.mutateUsage }),
}));

vi.mock('@/services/newApi', () => ({
  newApiService: {
    syncModels: mocks.syncModels,
  },
}));

vi.mock('@/utils/format', () => ({
  formatTokenNumber: (value: number) => `${value} tokens`,
}));

vi.mock('../../features/ModelList', () => ({
  default: ({ id }: { id: string }) => <div data-testid="model-list">{id}: gpt-4o-mini</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.syncModels.mockResolvedValue({
    models: [{ id: 'gpt-4o-mini' }, { id: 'glm5.1' }],
  });
});

afterEach(() => {
  cleanup();
});

describe('Aihub provider detail page', () => {
  it('renders binding, RMB rows, token usage, model list, and refreshes models', async () => {
    render(<Page />);

    expect(screen.getByText('Aihub 绑定')).toBeInTheDocument();
    expect(screen.getByText('已绑定')).toHaveAttribute('data-color', 'success');
    expect(screen.getByText('Aihub 用户 ID')).toBeInTheDocument();
    expect(screen.getByText('10193226')).toBeInTheDocument();
    expect(screen.getByText('余额')).toBeInTheDocument();
    expect(screen.getAllByText('¥0.14').every((node) => node.classList.contains('fieldValue'))).toBe(
      true,
    );
    expect(screen.getByText('Total Token')).toBeInTheDocument();
    expect(screen.getByText('50 tokens')).toBeInTheDocument();
    expect(screen.queryByText('原始余额 quota')).not.toBeInTheDocument();
    expect(screen.queryByText(/宸|鏈|鐢|浣|楼/)).not.toBeInTheDocument();
    expect(screen.getByTestId('model-list')).toHaveTextContent('newapi: gpt-4o-mini');

    fireEvent.click(screen.getByRole('button', { name: '刷新模型' }));

    await waitFor(() => expect(mocks.syncModels).toHaveBeenCalled());
    expect(mocks.mutateBinding).toHaveBeenCalled();
    expect(mocks.mutateAccount).toHaveBeenCalled();
    expect(mocks.mutateUsage).toHaveBeenCalled();
    expect(mocks.refreshAiModelList).toHaveBeenCalled();
    expect(mocks.refreshAiProviderDetail).toHaveBeenCalled();
    expect(mocks.messageSuccess).toHaveBeenCalledWith('已同步 2 个 Aihub 模型');
  });
});
