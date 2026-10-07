'use client';

import { Flexbox, type FlexboxProps, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { isUndefined } from 'es-toolkit/compat';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import {
  formatSubscriptionDate,
  hasNextReset,
  isActiveSubscription,
} from '@/features/Aihub/subscription';
import {
  useNewApiAccountSummary,
  useNewApiBindingStatus,
  useNewApiSubscriptionSummary,
} from '@/store/newApi';
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
  reset: css`
    padding-top: 8px;
    margin-top: 4px;
    border-top: 1px solid ${cssVar.colorBorderSecondary};
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
  const { t, i18n } = useTranslation('aihub');
  const { data: binding, isLoading: bindingLoading } = useNewApiBindingStatus();
  const isBound = !!binding?.isBound;
  const { data: account, isLoading: accountLoading } = useNewApiAccountSummary(isBound);
  const {
    data: subscriptions,
    isLoading: subscriptionLoading,
    error: subscriptionError,
  } = useNewApiSubscriptionSummary(isBound);
  const active = subscriptions?.subscriptions.filter((item) => isActiveSubscription(item)) || [];
  const nextReset = active
    .filter(hasNextReset)
    .sort((a, b) => a.nextResetTime - b.nextResetTime)[0];
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
            {binding?.status === 'active' ? t('bound') : t('unbound')}
          </Tag>
        </Flexbox>
        {isBound && (
          <AmountRow
            label={t('subscriptionRemaining')}
            value={
              subscriptionLoading
                ? loadingNode
                : subscriptionError && !subscriptions
                  ? t('readUnavailable')
                  : active.length === 0
                    ? t('noSubscription')
                    : active.some((item) => item.amountTotal === 0)
                      ? t('unlimited')
                      : !account?.quotaPolicy
                        ? '-'
                        : formatNewApiQuota(
                            active.reduce(
                              (sum, item) => sum + Math.max(0, item.amountTotal - item.amountUsed),
                              0,
                            ),
                            account?.quotaPolicy,
                            i18n.language,
                          )
            }
          />
        )}
        <AmountRow
          label={t('walletBalance')}
          value={
            loading || isUndefined(account?.quota)
              ? loadingNode
              : formatNewApiQuota(account.quota, account.quotaPolicy, i18n.language)
          }
        />
        <AmountRow
          label={t('cumulativeUsed')}
          value={
            loading || isUndefined(account?.usedQuota)
              ? loadingNode
              : formatNewApiQuota(account.usedQuota, account.quotaPolicy, i18n.language)
          }
        />
        {nextReset && (
          <Flexbox className={styles.reset} gap={3}>
            <span className={styles.label}>{t('nextReset')}</span>
            <span className={styles.value}>
              {nextReset.nextResetTime <= Date.now() / 1000
                ? t('resetPending')
                : formatSubscriptionDate(nextReset.nextResetTime, i18n.language)}
            </span>
            <span className={styles.label}>
              {t('resetTo', {
                amount:
                  nextReset.resetAmount === 0
                    ? t('unlimited')
                    : account?.quotaPolicy
                      ? formatNewApiQuota(nextReset.resetAmount, account.quotaPolicy, i18n.language)
                      : '-',
              })}
            </span>
          </Flexbox>
        )}
        <span className={styles.label} style={{ textAlign: 'right', paddingTop: 4 }}>
          {t('viewAccount')} →
        </span>
      </Flexbox>
    </Flexbox>
  );
});

export default NewApiBalance;
