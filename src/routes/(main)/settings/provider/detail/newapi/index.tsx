'use client';

import { ProviderCombine } from '@lobehub/icons';
import { Button, Flexbox, FormGroup, Tag, Text } from '@lobehub/ui';
import { Select, type SelectProps } from '@lobehub/ui/base-ui';
import { App, Divider } from 'antd';
import { createStyles } from 'antd-style';
import { LinkIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SubscriptionDetails from '@/features/Aihub/SubscriptionDetails';
import { useAiInfraStore } from '@/store/aiInfra';
import {
  useNewApiAccountSummary,
  useNewApiBindingStatus,
  useNewApiSubscriptionSummary,
  useNewApiUsageSummary,
} from '@/store/newApi';
import { formatNewApiQuota } from '@/utils/newApiQuota';

import ModelList from '../../features/ModelList';

const useStyles = createStyles(({ css, token }) => ({
  field: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    min-width: 180px;
  `,
  fieldValue: css`
    font-weight: 600;
    color: ${token.colorText};
    white-space: nowrap;
  `,
  tokenSelect: css`
    min-width: 220px;
  `,
}));

const Field = ({
  classNames,
  label,
  value,
}: {
  classNames: { field: string; fieldValue: string };
  label: string;
  value?: number | string | null;
}) => (
  <Flexbox className={classNames.field} gap={4}>
    <Text type="secondary">{label}</Text>
    <Text strong className={classNames.fieldValue}>
      {value ?? '-'}
    </Text>
  </Flexbox>
);

const ManagedTokenSelect = ({
  classNames,
  label,
  onChange,
  options,
  value,
}: {
  classNames: { field: string; tokenSelect: string };
  onChange: (value: string) => void;
  label: string;
  options: SelectProps['options'];
  value?: string;
}) => (
  <Flexbox className={classNames.field} gap={4}>
    <Text type="secondary">{label}</Text>
    <Select
      className={classNames.tokenSelect}
      disabled={!options?.length}
      options={options}
      placeholder="-"
      value={value}
      onChange={(nextValue) => onChange(String(nextValue))}
    />
  </Flexbox>
);

const Page = () => {
  const { t, i18n } = useTranslation('aihub');
  const BINDING_STATUS_TEXT: Record<string, string> = {
    active: t('healthy'),
    error: t('error'),
    missing: t('unbound'),
    pending: t('pending'),
  };

  const OAUTH_BINDING_STATUS_TEXT: Record<string, string> = {
    active: t('healthy'),
    conflict: t('conflict'),
    error: t('bindingFailed'),
    missing: t('unbound'),
    pending: t('binding'),
    unknown: t('unverified'),
  };

  const { styles } = useStyles();
  const { message } = App.useApp();
  const [syncing, setSyncing] = useState(false);
  const [rebinding, setRebinding] = useState(false);
  const [selectedManagedTokenId, setSelectedManagedTokenId] = useState<string>();
  const { data: binding, mutate: mutateBinding } = useNewApiBindingStatus();
  const isBound = !!binding?.isBound;
  const { data: account, mutate: mutateAccount } = useNewApiAccountSummary(isBound);
  const { data: usage, mutate: mutateUsage } = useNewApiUsageSummary(undefined, isBound);
  const {
    data: subscriptions,
    isLoading: subscriptionLoading,
    error: subscriptionError,
  } = useNewApiSubscriptionSummary(isBound);
  const useFetchAiProviderList = useAiInfraStore((s) => s.useFetchAiProviderList);
  const useFetchAiProviderItem = useAiInfraStore((s) => s.useFetchAiProviderItem);
  const quotaPolicy = usage?.quotaPolicy || account?.quotaPolicy;
  const oauthBindingStatus = binding?.oauthBinding?.status || 'unknown';
  const readinessNeedsRepair = binding?.status === 'error' || binding?.status === 'missing';
  const canRebind =
    readinessNeedsRepair || ['conflict', 'error', 'missing'].includes(oauthBindingStatus);
  const showRebind = canRebind || oauthBindingStatus === 'pending';
  const bindingTag = !isBound
    ? { color: 'warning', text: t('unbound') }
    : oauthBindingStatus === 'active'
      ? { color: 'success', text: t('bound') }
      : oauthBindingStatus === 'unknown' || oauthBindingStatus === 'pending'
        ? { color: 'warning', text: t('unverified') }
        : { color: 'error', text: t('bindingError') };

  useFetchAiProviderList();
  useFetchAiProviderItem('newapi');

  const managedTokenOptions = useMemo<SelectProps['options']>(
    () =>
      (binding?.managedTokens || []).map((token) => ({
        label: token.name || `Token #${token.id}`,
        value: String(token.id),
      })),
    [binding?.managedTokens],
  );

  useEffect(() => {
    const firstToken = managedTokenOptions?.find((option) => 'value' in option)?.value;
    setSelectedManagedTokenId(firstToken === undefined ? undefined : String(firstToken));
  }, [managedTokenOptions]);

  const handleSyncModels = async () => {
    setSyncing(true);
    try {
      const { newApiService } = await import('@/services/newApi');
      const result = await newApiService.syncModels();

      await Promise.all([
        mutateBinding(),
        mutateAccount(),
        mutateUsage(),
        useAiInfraStore.getState().refreshAiModelList(),
        useAiInfraStore.getState().refreshAiProviderDetail(),
      ]);

      message.success(t('syncSuccess', { count: result.models.length }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  };

  const handleRebind = async () => {
    if (rebinding) return;
    setRebinding(true);
    try {
      const { newApiService } = await import('@/services/newApi');
      const result = await newApiService.rebindCurrentUser();
      await Promise.all([mutateBinding(), mutateAccount(), mutateUsage()]);

      if (result.status === 'active') {
        message.success(t('rebindSuccess'));
      } else if (result.status === 'conflict') {
        message.error(t('rebindConflict'));
      } else {
        message.error(result.errorMessage || t('rebindFailed'));
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRebinding(false);
    }
  };

  return (
    <Flexbox gap={24} paddingBlock={8}>
      <FormGroup
        collapsible={false}
        variant="filled"
        extra={
          <Flexbox horizontal gap={8}>
            {showRebind && (
              <Button
                disabled={!canRebind}
                icon={LinkIcon}
                loading={rebinding || oauthBindingStatus === 'pending'}
                size="small"
                onClick={handleRebind}
              >
                {t('rebind')}
              </Button>
            )}
            <Button
              disabled={!isBound}
              icon={RefreshCwIcon}
              loading={syncing}
              size="small"
              onClick={handleSyncModels}
            >
              {t('refresh')}
            </Button>
          </Flexbox>
        }
        title={
          <Flexbox horizontal align="center" gap={8}>
            <ProviderCombine provider="newapi" size={24} />
            <span>{t('bindingTitle')}</span>
            <Tag color={bindingTag.color}>{bindingTag.text}</Tag>
          </Flexbox>
        }
      >
        <Flexbox gap={16}>
          <Flexbox horizontal gap={24} style={{ flexWrap: 'wrap' }}>
            <Field
              classNames={styles}
              label={t('masterinoStatus')}
              value={
                BINDING_STATUS_TEXT[binding?.status || 'missing'] || binding?.status || t('unbound')
              }
            />
            <ManagedTokenSelect
              classNames={styles}
              label={t('managedToken')}
              options={managedTokenOptions}
              value={selectedManagedTokenId}
              onChange={setSelectedManagedTokenId}
            />
            <Field
              classNames={styles}
              label={t('oauthStatus')}
              value={OAUTH_BINDING_STATUS_TEXT[oauthBindingStatus] || oauthBindingStatus}
            />
            <Field
              classNames={styles}
              label={t('lastSynced')}
              value={
                binding?.lastSyncedAt
                  ? new Date(binding.lastSyncedAt).toLocaleString(i18n.language)
                  : '-'
              }
            />
          </Flexbox>
          {binding?.errorMessage && (
            <Text style={{ whiteSpace: 'pre-wrap' }} type="danger">
              {binding.errorMessage}
            </Text>
          )}
          {binding?.oauthBinding?.errorMessage && (
            <Text style={{ whiteSpace: 'pre-wrap' }} type="danger">
              {binding.oauthBinding.errorMessage}
            </Text>
          )}
          <Divider style={{ margin: 0 }} />
          <Flexbox horizontal gap={24} style={{ flexWrap: 'wrap' }}>
            <Field classNames={styles} label={t('username')} value={account?.username} />
            <Field classNames={styles} label={t('group')} value={account?.group} />
            <Field
              classNames={styles}
              label={t('walletBalance')}
              value={formatNewApiQuota(account?.quota, quotaPolicy, i18n.language)}
            />
            <Field
              classNames={styles}
              label={t('cumulativeUsed')}
              value={formatNewApiQuota(account?.usedQuota, quotaPolicy, i18n.language)}
            />
            <Field classNames={styles} label={t('requests')} value={account?.requestCount} />
            <Field
              classNames={styles}
              label={t('cost')}
              value={formatNewApiQuota(usage?.totalQuota, quotaPolicy, i18n.language)}
            />
          </Flexbox>
          {isBound && (
            <SubscriptionDetails
              data={subscriptions}
              error={subscriptionError}
              loading={subscriptionLoading}
              quotaPolicy={quotaPolicy}
            />
          )}
        </Flexbox>
      </FormGroup>

      <ModelList
        id="newapi"
        modelEditable={false}
        sdkType="router"
        showAddNewModel={false}
        showClearModels={false}
        showModelFetcher={false}
      />
    </Flexbox>
  );
};

export default Page;
