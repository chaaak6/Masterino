import type { NewApiQuotaPolicy, NewApiSubscriptionSummary } from '@lobechat/types';
import { Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatNewApiQuota } from '@/utils/newApiQuota';

import {
  AIHUB_ACCOUNT_URL,
  formatSubscriptionDate,
  hasNextReset,
  isActiveSubscription,
} from './subscription';

const styles = createStaticStyles(({ css, cssVar }) => ({
  section: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-top: 20px;
    border-top: 1px solid ${cssVar.colorBorderSecondary};
  `,
  heading: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  `,
  title: css`
    font-size: 16px;
    font-weight: 600;
  `,
  link: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    color: ${cssVar.colorPrimary};
    font-size: 13px;
    white-space: nowrap;
    &:hover {
      text-decoration: underline;
    }
  `,
  card: css`
    padding: 18px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  metrics: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 20px;
    margin-top: 18px;
  `,
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  amount: css`
    margin-top: 4px;
    font-size: 24px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  `,
  date: css`
    margin-top: 6px;
    font-size: 13px;
    font-weight: 500;
  `,
  muted: css`
    font-size: 13px;
    color: ${cssVar.colorTextDescription};
  `,
  progress: css`
    width: 100%;
    height: 5px;
    margin-top: 16px;
    accent-color: ${cssVar.colorPrimary};
  `,
  footer: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
}));

interface Props {
  data?: NewApiSubscriptionSummary;
  error?: unknown;
  loading?: boolean;
  quotaPolicy?: NewApiQuotaPolicy;
}

export default function SubscriptionDetails({ data, error, loading, quotaPolicy }: Props) {
  const { t, i18n } = useTranslation('aihub');
  const active = data?.subscriptions.filter((item) => isActiveSubscription(item)) || [];
  // New API blocks wallet fallback if any active, unexpired subscription disallows it.
  const walletFallbackBlocked = data?.subscriptions.some(
    (item) =>
      item.status === 'active' && item.endTime > Date.now() / 1000 && !item.allowWalletOverflow,
  );
  const amount = (value: number) =>
    quotaPolicy ? formatNewApiQuota(value, quotaPolicy, i18n.language) : '-';
  return (
    <section aria-label={t('subscriptionTitle')} className={styles.section}>
      <div className={styles.heading}>
        <span className={styles.title}>{t('subscriptionTitle')}</span>
        <a
          className={styles.link}
          href={AIHUB_ACCOUNT_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t(data === undefined || active.length > 0 ? 'manageSubscription' : 'subscribe')}
          <ArrowUpRight size={14} />
        </a>
      </div>
      {loading && !data ? (
        <div className={styles.muted}>{t('subscriptionLoading')}</div>
      ) : error && !data ? (
        <div className={styles.muted} role="status">
          {t('subscriptionUnavailable')}
        </div>
      ) : active.length === 0 ? (
        <div className={styles.card}>
          <strong>{t('noSubscription')}</strong>
          <p className={styles.muted}>{t('subscriptionHint')}</p>
        </div>
      ) : (
        active.map((item) => {
          const remaining = Math.max(0, item.amountTotal - item.amountUsed);
          const unlimited = item.amountTotal === 0;
          const exhausted = !unlimited && remaining === 0;
          return (
            <article className={styles.card} key={item.id}>
              <div className={styles.heading}>
                <strong>{item.title || t('subscriptionUnnamed')}</strong>
                <Tag color={exhausted ? 'warning' : 'success'}>
                  {t(exhausted ? 'subscriptionExhausted' : 'subscriptionActive')}
                </Tag>
              </div>
              <div className={styles.metrics}>
                <div>
                  <div className={styles.label}>{t('subscriptionRemaining')}</div>
                  <div className={styles.amount}>
                    {unlimited ? t('subscriptionUnlimited') : amount(remaining)}
                  </div>
                </div>
                <div>
                  <div className={styles.label}>{t('periodUsed')}</div>
                  <div className={styles.amount}>{amount(item.amountUsed)}</div>
                  <div className={styles.muted}>
                    {t('periodQuota')} {unlimited ? t('unlimited') : amount(item.amountTotal)}
                  </div>
                </div>
                <div>
                  <div className={styles.label}>{t('nextReset')}</div>
                  <div className={styles.date}>
                    {!hasNextReset(item)
                      ? t('noReset')
                      : item.nextResetTime <= Date.now() / 1000
                        ? t('resetPending')
                        : formatSubscriptionDate(item.nextResetTime, i18n.language)}
                  </div>
                  {hasNextReset(item) && (
                    <div className={styles.muted}>
                      {t('resetTo', {
                        amount: item.resetAmount === 0 ? t('unlimited') : amount(item.resetAmount),
                      })}
                    </div>
                  )}
                </div>
              </div>
              {!unlimited && (
                <progress
                  className={styles.progress}
                  max={item.amountTotal}
                  value={Math.min(item.amountUsed, item.amountTotal)}
                  aria-label={t('subscriptionUsage', {
                    used: amount(item.amountUsed),
                    total: amount(item.amountTotal),
                  })}
                />
              )}
              <div className={styles.footer} style={{ marginTop: 12 }}>
                <span>
                  {t('subscriptionEnds')}{' '}
                  {item.endTime
                    ? formatSubscriptionDate(item.endTime, i18n.language)
                    : t('noExpiry')}
                </span>
              </div>
            </article>
          );
        })
      )}
      {data && (
        <div className={styles.footer}>
          <span>
            {t('billingPreference')} · {t(data.billingPreference)}
          </span>
          {data.billingPreference === 'subscription_first' && active.length > 0 && (
            <span>{t(walletFallbackBlocked ? 'noWalletOverflow' : 'walletOverflow')}</span>
          )}
        </div>
      )}
      {data &&
        active.length === 0 &&
        data.subscriptions.some(
          (item) => item.endTime > 0 && item.endTime <= Date.now() / 1000,
        ) && <div className={styles.muted}>{t('subscriptionExpired')}</div>}
    </section>
  );
}
