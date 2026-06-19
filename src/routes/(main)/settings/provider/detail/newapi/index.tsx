'use client';

import { ProviderCombine } from '@lobehub/icons';
import { Button, Flexbox, FormGroup, Tag, Text } from '@lobehub/ui';
import { App, Divider } from 'antd';
import { createStyles } from 'antd-style';
import { RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';

import { useAiInfraStore } from '@/store/aiInfra';
import {
  useNewApiAccountSummary,
  useNewApiBindingStatus,
  useNewApiUsageSummary,
} from '@/store/newApi';
import { formatTokenNumber } from '@/utils/format';
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

const Page = () => {
  const { styles } = useStyles();
  const { message } = App.useApp();
  const [syncing, setSyncing] = useState(false);
  const { data: binding, mutate: mutateBinding } = useNewApiBindingStatus();
  const isBound = !!binding?.isBound;
  const { data: account, mutate: mutateAccount } = useNewApiAccountSummary(isBound);
  const { data: usage, mutate: mutateUsage } = useNewApiUsageSummary(undefined, isBound);
  const useFetchAiProviderList = useAiInfraStore((s) => s.useFetchAiProviderList);
  const useFetchAiProviderItem = useAiInfraStore((s) => s.useFetchAiProviderItem);
  const quotaPolicy = usage?.quotaPolicy || account?.quotaPolicy;

  useFetchAiProviderList();
  useFetchAiProviderItem('newapi');

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
            <span>Aihub 绑定</span>
            <Tag color={binding?.status === 'active' ? 'success' : 'warning'}>
              {binding?.status === 'active' ? '已绑定' : '未绑定'}
            </Tag>
          </Flexbox>
        }
        variant="filled"
      >
        <Flexbox gap={16}>
          <Flexbox horizontal gap={24} style={{ flexWrap: 'wrap' }}>
            <Field classNames={styles} label="MasterLion 状态" value={binding?.status || 'missing'} />
            <Field classNames={styles} label="Aihub 用户 ID" value={binding?.newApiUserId} />
            <Field
              classNames={styles}
              label="托管 Token ID"
              value={binding?.managedTokenId ? String(binding.managedTokenId) : undefined}
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
              label="托管 Token 可用额度"
              value={
                usage?.tokenUsage.unlimitedQuota
                  ? '不限'
                  : formatNewApiQuota(usage?.tokenUsage.totalAvailable, quotaPolicy)
              }
            />
            <Field
              classNames={styles}
              label="消耗金额"
              value={formatNewApiQuota(usage?.totalQuota, quotaPolicy)}
            />
            <Field
              classNames={styles}
              label="Total Token"
              value={formatTokenNumber(usage?.totalTokens || 0)}
            />
            <Field
              classNames={styles}
              label="Prompt Token"
              value={formatTokenNumber(usage?.totalPromptTokens || 0)}
            />
            <Field
              classNames={styles}
              label="Completion Token"
              value={formatTokenNumber(usage?.totalCompletionTokens || 0)}
            />
          </Flexbox>
        </Flexbox>
      </FormGroup>

      <ModelList
        id="newapi"
        modelEditable={false}
        sdkType="router"
        showAddNewModel={false}
        showModelFetcher={false}
      />
    </Flexbox>
  );
};

export default Page;
