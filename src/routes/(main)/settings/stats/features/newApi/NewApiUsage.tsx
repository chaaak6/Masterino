'use client';

import { Flexbox, FormGroup, Text } from '@lobehub/ui';
import { Progress, Table } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useMemo } from 'react';

import { useNewApiBindingStatus, useNewApiUsageSummary } from '@/store/newApi';
import { formatTokenNumber } from '@/utils/format';
import { formatNewApiQuota } from '@/utils/newApiQuota';

const useStyles = createStyles(({ css, token }) => ({
  metricLabel: css`
    color: ${token.colorTextDescription};
  `,
  metricRow: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    padding: 10px 12px;
    border-radius: ${token.borderRadius}px;
    background: ${token.colorFillTertiary};
  `,
  metricValue: css`
    white-space: nowrap;
    font-size: 16px;
    font-weight: 700;
    line-height: 1.2;
  `,
  modelRow: css`
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(160px, 2fr) 120px 88px;
    gap: 12px;
    align-items: center;
  `,
}));

const NewApiUsage = memo(() => {
  const { styles } = useStyles();
  const { data: binding } = useNewApiBindingStatus();
  const { data, isLoading } = useNewApiUsageSummary(undefined, !!binding?.isBound);
  const quotaPolicy = data?.quotaPolicy || data?.account.quotaPolicy;

  const modelRows = useMemo(() => {
    const rows = Object.entries(data?.byModel || {})
      .map(([model, item]) => ({ model, ...item }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
    const maxTokens = rows[0]?.totalTokens || 1;

    return rows.slice(0, 8).map((item) => ({
      ...item,
      percent: Math.round((item.totalTokens / maxTokens) * 100),
    }));
  }, [data]);

  const dayRows = useMemo(() => {
    const rows = Object.entries(data?.byDay || {})
      .map(([day, item]) => ({ day, ...item }))
      .sort((a, b) => a.day.localeCompare(b.day));
    const maxTokens = Math.max(...rows.map((row) => row.totalTokens), 1);

    return rows.slice(-14).map((item) => ({
      ...item,
      percent: Math.round((item.totalTokens / maxTokens) * 100),
    }));
  }, [data]);

  if (!binding?.isBound) {
    return (
      <FormGroup collapsible={false} title="Aihub 用量" variant="filled">
        <Text type="secondary">当前账号尚未绑定 Aihub 用户。</Text>
      </FormGroup>
    );
  }

  const metrics = [
    {
      label: '消耗金额',
      value: isLoading ? '-' : formatNewApiQuota(data?.totalQuota, quotaPolicy),
    },
    {
      label: '托管 Token 可用额度',
      value: isLoading
        ? '-'
        : data?.tokenUsage.unlimitedQuota
          ? '不限'
          : formatNewApiQuota(data?.tokenUsage.totalAvailable, quotaPolicy),
    },
    { label: '请求数', value: isLoading ? '-' : data?.requestCount || 0 },
    {
      label: 'Prompt Token',
      value: isLoading ? '-' : formatTokenNumber(data?.totalPromptTokens || 0),
    },
    {
      label: 'Completion Token',
      value: isLoading ? '-' : formatTokenNumber(data?.totalCompletionTokens || 0),
    },
    {
      label: 'Total Token',
      value: isLoading ? '-' : formatTokenNumber(data?.totalTokens || 0),
    },
  ];

  return (
    <FormGroup collapsible={false} gap={16} title="Aihub 用量" variant="filled">
      <Flexbox gap={8}>
        {metrics.map((metric) => (
          <div className={styles.metricRow} key={metric.label}>
            <span className={styles.metricLabel}>{metric.label}</span>
            <span className={styles.metricValue}>{metric.value}</span>
          </div>
        ))}
      </Flexbox>

      <Flexbox gap={10}>
        <Text strong>近 14 天趋势</Text>
        {dayRows.map((row) => (
          <div className={styles.modelRow} key={row.day}>
            <Text ellipsis>{row.day}</Text>
            <Progress percent={row.percent} showInfo={false} size="small" />
            <Text type="secondary">{formatNewApiQuota(row.quota, quotaPolicy)}</Text>
            <Text type="secondary">{formatTokenNumber(row.totalTokens)}</Text>
          </div>
        ))}
      </Flexbox>

      <Flexbox gap={10}>
        <Text strong>模型用量</Text>
        {modelRows.map((row) => (
          <div className={styles.modelRow} key={row.model}>
            <Text ellipsis>{row.model}</Text>
            <Progress percent={row.percent} showInfo={false} size="small" />
            <Text type="secondary">{formatNewApiQuota(row.quota, quotaPolicy)}</Text>
            <Text type="secondary">{formatTokenNumber(row.totalTokens)}</Text>
          </div>
        ))}
      </Flexbox>

      <Table
        rowKey="id"
        columns={[
          {
            dataIndex: 'createdAt',
            render: (v: number) => new Date(v * 1000).toLocaleString(),
            title: '时间',
          },
          { dataIndex: 'modelName', title: '模型' },
          { dataIndex: 'totalTokens', render: (v: number) => formatTokenNumber(v), title: 'Token' },
          {
            dataIndex: 'quota',
            render: (v: number) => formatNewApiQuota(v, quotaPolicy),
            title: '金额',
          },
        ]}
        dataSource={data?.recentLogs || []}
        pagination={false}
        size="small"
      />
    </FormGroup>
  );
});

export default NewApiUsage;
