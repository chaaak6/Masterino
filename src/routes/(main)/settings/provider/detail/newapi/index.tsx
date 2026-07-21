'use client';

import { ProviderCombine } from '@lobehub/icons';
import { Button, Flexbox, FormGroup, Tag, Text } from '@lobehub/ui';
import { Select, type SelectProps } from '@lobehub/ui/base-ui';
import { App, Divider } from 'antd';
import { createStyles } from 'antd-style';
import { RefreshCwIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAiInfraStore } from '@/store/aiInfra';
import {
  useNewApiAccountSummary,
  useNewApiBindingStatus,
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
    white-space: nowrap;
    font-weight: 600;
    color: ${token.colorText};
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
    <Text className={classNames.fieldValue} strong>
      {value ?? '-'}
    </Text>
  </Flexbox>
);

const ManagedTokenSelect = ({
  classNames,
  onChange,
  options,
  value,
}: {
  classNames: { field: string; tokenSelect: string };
  onChange: (value: string) => void;
  options: SelectProps['options'];
  value?: string;
}) => (
  <Flexbox className={classNames.field} gap={4}>
    <Text type="secondary">托管 Token</Text>
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

const BINDING_STATUS_TEXT: Record<string, string> = {
  active: '正常',
  error: '异常',
  missing: '未绑定',
  pending: '待同步',
};

const Page = () => {
  const { styles } = useStyles();
  const { message } = App.useApp();
  const [syncing, setSyncing] = useState(false);
  const [selectedManagedTokenId, setSelectedManagedTokenId] = useState<string>();
  const { data: binding, mutate: mutateBinding } = useNewApiBindingStatus();
  const isBound = !!binding?.isBound;
  const { data: account, mutate: mutateAccount } = useNewApiAccountSummary(isBound);
  const { data: usage, mutate: mutateUsage } = useNewApiUsageSummary(undefined, isBound);
  const useFetchAiProviderList = useAiInfraStore((s) => s.useFetchAiProviderList);
  const useFetchAiProviderItem = useAiInfraStore((s) => s.useFetchAiProviderItem);
  const quotaPolicy = usage?.quotaPolicy || account?.quotaPolicy;

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

      message.success(`已同步 ${result.models.length} 个 Aihub 模型`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Flexbox gap={24} paddingBlock={8}>
      <FormGroup
        collapsible={false}
        extra={
          <Button
            disabled={!isBound}
            icon={RefreshCwIcon}
            loading={syncing}
            size="small"
            onClick={handleSyncModels}
          >
            刷新模型
          </Button>
        }
        title={
          <Flexbox horizontal align="center" gap={8}>
            <ProviderCombine provider="newapi" size={24} />
            <span>Aihub绑定情况</span>
            <Tag color={binding?.status === 'active' ? 'success' : 'warning'}>
              {binding?.status === 'active' ? '已绑定' : '未绑定'}
            </Tag>
          </Flexbox>
        }
        variant="filled"
      >
        <Flexbox gap={16}>
          <Flexbox horizontal gap={24} style={{ flexWrap: 'wrap' }}>
            <Field
              classNames={styles}
              label="Masterion状态"
              value={BINDING_STATUS_TEXT[binding?.status || 'missing'] || binding?.status || '未绑定'}
            />
            <ManagedTokenSelect
              classNames={styles}
              options={managedTokenOptions}
              value={selectedManagedTokenId}
              onChange={setSelectedManagedTokenId}
            />
            <Field
              classNames={styles}
              label="最近同步"
              value={binding?.lastSyncedAt ? new Date(binding.lastSyncedAt).toLocaleString() : '-'}
            />
          </Flexbox>
          {binding?.errorMessage && (
            <Text style={{ whiteSpace: 'pre-wrap' }} type="danger">
              {binding.errorMessage}
            </Text>
          )}
          <Divider style={{ margin: 0 }} />
          <Flexbox horizontal gap={24} style={{ flexWrap: 'wrap' }}>
            <Field classNames={styles} label="用户名" value={account?.username} />
            <Field classNames={styles} label="用户组" value={account?.group} />
            <Field
              classNames={styles}
              label="余额"
              value={formatNewApiQuota(account?.quota, quotaPolicy)}
            />
            <Field
              classNames={styles}
              label="已用金额"
              value={formatNewApiQuota(account?.usedQuota, quotaPolicy)}
            />
            <Field classNames={styles} label="请求数" value={account?.requestCount} />
            <Field
              classNames={styles}
              label="消耗金额"
              value={formatNewApiQuota(usage?.totalQuota, quotaPolicy)}
            />
          </Flexbox>
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
