import useSWR from 'swr';

const read = async (path: string) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Test response unavailable');
  return response.json();
};
export const useNewApiBindingStatus = () => ({
  data: {
    isBound: true,
    status: 'active',
    oauthBinding: { status: 'active' },
    managedTokens: [{ id: 1, name: '测试 Token' }],
    lastSyncedAt: new Date('2026-10-07T00:00:00Z'),
  },
});
export const useNewApiAccountSummary = () => useSWR('/fixture/account', read);
export const useNewApiSubscriptionSummary = () =>
  useSWR('/fixture/subscriptions', read, { shouldRetryOnError: false, dedupingInterval: 30_000 });
export const useNewApiUsageSummary = () => ({
  data: { totalQuota: 7685000 },
  mutate: async () => {},
});
const state = {
  useFetchAiProviderList: () => {},
  useFetchAiProviderItem: () => {},
  refreshAiModelList: async () => {},
  refreshAiProviderDetail: async () => {},
};
export const useAiInfraStore = Object.assign(
  (selector: (value: typeof state) => unknown) => selector(state),
  { getState: () => state },
);
export const newApiService = {
  syncModels: async () => {
    throw new Error('Model refresh is outside this preview');
  },
  rebindCurrentUser: async () => {
    throw new Error('Account writes are disabled in this preview');
  },
};
