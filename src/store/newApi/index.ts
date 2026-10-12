import type {
  NewApiAccountSummary,
  NewApiBindingStatus,
  NewApiSubscriptionSummary,
  NewApiUsageSummary,
} from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { newApiService } from '@/services/newApi';

export const newApiKeys = {
  accountSummary: () => ['aihub:accountSummary'] as const,
  bindingStatus: () => ['aihub:bindingStatus'] as const,
  usageSummary: (params?: { endTimestamp?: number; startTimestamp?: number }) =>
    ['aihub:usageSummary', params?.startTimestamp ?? null, params?.endTimestamp ?? null] as const,
};

export const useNewApiBindingStatus = () =>
  useClientDataSWR<NewApiBindingStatus>(newApiKeys.bindingStatus(), () =>
    newApiService.getBindingStatus(),
  );

export const useNewApiAccountSummary = (enabled = true) =>
  useClientDataSWR<NewApiAccountSummary>(
    enabled ? newApiKeys.accountSummary() : null,
    () => newApiService.getAccountSummary(),
    {
      shouldRetryOnError: false,
    },
  );

export const useNewApiUsageSummary = (
  params?: { endTimestamp?: number; startTimestamp?: number },
  enabled = true,
) =>
  useClientDataSWR<NewApiUsageSummary>(
    enabled ? newApiKeys.usageSummary(params) : null,
    () => newApiService.getUsageSummary(params),
    {
      shouldRetryOnError: false,
    },
  );

export const useNewApiSubscriptionSummary = (enabled = true) =>
  useClientDataSWR<NewApiSubscriptionSummary>(
    enabled ? ['aihub:subscriptionSummary'] : null,
    () => newApiService.getSubscriptionSummary(),
    { dedupingInterval: 30_000, focusThrottleInterval: 30_000, shouldRetryOnError: false },
  );
