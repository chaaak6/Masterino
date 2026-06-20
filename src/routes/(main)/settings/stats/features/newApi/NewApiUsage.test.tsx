import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NewApiUsage from './NewApiUsage';

const mocks = vi.hoisted(() => ({
  binding: { isBound: true },
  usage: {
    account: {
      newApiUserId: 6,
      quotaPolicy: {
        quotaDisplayType: 'CNY' as const,
        quotaPerUnit: 500_000,
        usdExchangeRate: 7.12,
      },
    },
    byDay: {
      '2026-06-19': {
        completionTokens: 20,
        promptTokens: 10,
        quota: 10_000,
        requests: 1,
        totalTokens: 30,
      },
    },
    byModel: {
      'glm5.1': {
        completionTokens: 20,
        promptTokens: 10,
        quota: 10_000,
        requests: 1,
        totalTokens: 30,
      },
    },
    quotaPolicy: {
      quotaDisplayType: 'CNY' as const,
      quotaPerUnit: 500_000,
      usdExchangeRate: 7.12,
    },
    recentLogs: [
      {
        completionTokens: 20,
        createdAt: 1_781_798_400,
        id: 1,
        modelName: 'glm5.1',
        promptTokens: 10,
        quota: 10_000,
        totalTokens: 30,
      },
    ],
    requestCount: 1,
    tokenUsage: {
      totalAvailable: 8_750,
      unlimitedQuota: false,
    },
    totalCompletionTokens: 20,
    totalPromptTokens: 10,
    totalQuota: 10_000,
    totalTokens: 30,
  },
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  FormGroup: ({ children, title }: { children: ReactNode; title?: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  Progress: () => <span data-testid="progress" />,
  Table: ({
    columns,
    dataSource,
  }: {
    columns: { dataIndex: string; render?: (value: any) => ReactNode; title: string }[];
    dataSource: Record<string, any>[];
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.dataIndex}>{column.title}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dataSource.map((row) => (
          <tr key={row.id}>
            {columns.map((column) => (
              <td key={column.dataIndex}>
                {column.render ? column.render(row[column.dataIndex]) : row[column.dataIndex]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: {
      metricLabel: 'metricLabel',
      metricRow: 'metricRow',
      metricValue: 'metricValue',
      modelRow: 'modelRow',
    },
  }),
}));

vi.mock('@/store/newApi', () => ({
  useNewApiBindingStatus: () => ({ data: mocks.binding }),
  useNewApiUsageSummary: () => ({ data: mocks.usage, isLoading: false }),
}));

vi.mock('@/utils/format', () => ({
  formatTokenNumber: (value: number) => `${value} tokens`,
}));

beforeEach(() => {
  mocks.binding = { isBound: true };
});

afterEach(() => {
  cleanup();
});

describe('NewApiUsage', () => {
  it('renders RMB amount rows, request count, and token usage without mojibake text', () => {
    render(<NewApiUsage />);

    expect(screen.getByText('Aihub 用量')).toBeInTheDocument();
    expect(screen.getByText('消耗金额')).toBeInTheDocument();
    expect(screen.getByText('请求数')).toBeInTheDocument();
    expect(screen.getByText('Prompt Token')).toBeInTheDocument();
    expect(screen.getByText('Completion Token')).toBeInTheDocument();
    expect(screen.getByText('Total Token')).toBeInTheDocument();
    expect(screen.getAllByText('¥0.14').length).toBeGreaterThan(0);
    expect(screen.getAllByText('30 tokens').length).toBeGreaterThan(0);
    expect(screen.getAllByText('glm5.1').length).toBeGreaterThan(0);
    expect(screen.queryByText(/[宸鏈鐢浣楼]/)).not.toBeInTheDocument();
  });

  it('shows a clear local message when the current user is not bound', () => {
    mocks.binding = { isBound: false };

    render(<NewApiUsage />);

    expect(screen.getByText('当前账号尚未绑定 Aihub 用户。')).toBeInTheDocument();
  });
});
