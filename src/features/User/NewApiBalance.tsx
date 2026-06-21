'use client';

import { Flexbox, type FlexboxProps, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { isUndefined } from 'es-toolkit/compat';
import { memo, type ReactNode } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useNewApiAccountSummary, useNewApiBindingStatus } from '@/store/newApi';
import { formatNewApiQuota } from '@/utils/newApiQuota';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 8px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  label: css`
    min-width: 0;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  value: css`
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
  `,
}));

const AmountRow = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className={styles.row}>
    <span className={styles.label}>{label}</span>
    <span className={styles.value}>{value}</span>
  </div>
);

const NewApiBalance = memo<Omit<FlexboxProps, 'children'>>(({ style, ...rest }) => {
  const { data: binding, isLoading: bindingLoading } = useNewApiBindingStatus();
  const isBound = !!binding?.isBound;
  const { data: account, isLoading: accountLoading } = useNewApiAccountSummary(isBound);
  const loading = bindingLoading || accountLoading;
  const loadingNode = <NeuralNetworkLoading size={20} />;

  return (
    <Flexbox
      gap={6}
      paddingInline={8}
      style={{ marginBottom: 8, ...style }}
      width={'100%'}
      {...rest}
    >
      <Flexbox className={styles.card} gap={6}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <span className={styles.label}>AIHUB</span>
          <Tag color={binding?.status === 'active' ? 'success' : 'warning'}>
            {binding?.status === 'active' ? '已绑定' : '未绑定'}
          </Tag>
        </Flexbox>
        <AmountRow
          label="AIHUB 余额"
          value={
            loading || isUndefined(account?.quota)
              ? loadingNode
              : formatNewApiQuota(account.quota, account.quotaPolicy)
          }
        />
        <AmountRow
          label="已用金额"
          value={
            loading || isUndefined(account?.usedQuota)
              ? loadingNode
              : formatNewApiQuota(account.usedQuota, account.quotaPolicy)
          }
        />
        <AmountRow
          label="请求数"
          value={loading || isUndefined(account?.requestCount) ? loadingNode : account.requestCount}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default NewApiBalance;
