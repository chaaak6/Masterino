'use client';

import { Flexbox, FormGroup, Text } from '@lobehub/ui';
import { Progress, Table } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t, i18n } = useTranslation('aihub');
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
      <FormGroup collapsible={false} title={t('usage')} variant="filled">
        <Text type="secondary">{t('notBound')}</Text>
      </FormGroup>
    );
  }

  const metrics = [
    {
      label: t('cost'),
      value: isLoading ? '-' : formatNewApiQuota(data?.totalQuota, quotaPolicy, i18n.language),
    },
    {
      label: t('available'),
      value: isLoading
        ? '-'
        : data?.tokenUsage.unlimitedQuota
          ? t('unlimited')
          : formatNewApiQuota(data?.tokenUsage.totalAvailable, quotaPolicy, i18n.language),
    },
    { label: t('requests'), value: isLoading ? '-' : data?.requestCount || 0 },
    {
      label: t('promptTokens'),
      value: isLoading ? '-' : formatTokenNumber(data?.totalPromptTokens || 0),
    },
    {
      label: t('completionTokens'),
      value: isLoading ? '-' : formatTokenNumber(data?.totalCompletionTokens || 0),
    },
    {
      label: t('totalTokens'),
      value: isLoading ? '-' : formatTokenNumber(data?.totalTokens || 0),
    },
  ];

  return (
    <FormGroup collapsible={false} gap={16} title={t('usage')} variant="filled">
      <Flexbox gap={8}>
        {metrics.map((metric) => (
          <div className={styles.metricRow} key={metric.label}>
            <span className={styles.metricLabel}>{metric.label}</span>
            <span className={styles.metricValue}>{metric.value}</span>
          </div>
        ))}
      </Flexbox>

      <Flexbox gap={10}>
        <Text strong>{t('last14Days')}</Text>
        {dayRows.map((row) => (
          <div className={styles.modelRow} key={row.day}>
            <Text ellipsis>{row.day}</Text>
            <Progress percent={row.percent} showInfo={false} size="small" />
            <Text type="secondary">{formatNewApiQuota(row.quota, quotaPolicy, i18n.language)}</Text>
            <Text type="secondary">{formatTokenNumber(row.totalTokens)}</Text>
          </div>
        ))}
      </Flexbox>

      <Flexbox gap={10}>
        <Text strong>{t('modelUsage')}</Text>
        {modelRows.map((row) => (
          <div className={styles.modelRow} key={row.model}>
            <Text ellipsis>{row.model}</Text>
            <Progress percent={row.percent} showInfo={false} size="small" />
            <Text type="secondary">{formatNewApiQuota(row.quota, quotaPolicy, i18n.language)}</Text>
            <Text type="secondary">{formatTokenNumber(row.totalTokens)}</Text>
          </div>
        ))}
      </Flexbox>

      <Table
        dataSource={data?.recentLogs || []}
        pagination={false}
        rowKey="id"
        size="small"
        columns={[
          {
            dataIndex: 'createdAt',
            render: (v: number) => new Date(v * 1000).toLocaleString(i18n.language),
            title: t('time'),
          },
          { dataIndex: 'modelName', title: t('model') },
          { dataIndex: 'totalTokens', render: (v: number) => formatTokenNumber(v), title: 'Token' },
          {
            dataIndex: 'quota',
            render: (v: number) => formatNewApiQuota(v, quotaPolicy, i18n.language),
            title: t('amount'),
          },
        ]}
      />
    </FormGroup>
  );
});

export default NewApiUsage;
