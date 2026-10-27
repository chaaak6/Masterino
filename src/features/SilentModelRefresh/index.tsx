import { memo, useEffect } from 'react';

import { lambdaClient } from '@/libs/trpc/client';
import { useAiInfraStore } from '@/store/aiInfra';
import { useNewApiBindingStatus } from '@/store/newApi';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { SilentModelRefreshController } from './controller';

const SilentModelRefresh = memo(() => {
  const userId = useUserStore((s) => s.user?.id);
  const loggedIn = useUserStore(authSelectors.isLogin);
  const initialized = useAiInfraStore((s) => s.isInitAiProviderRuntimeState);
  const binding = useNewApiBindingStatus();
  const ready = loggedIn && initialized && binding.data?.status === 'active';
  useEffect(() => {
    if (!ready || !userId) return;
    const controller = new SilentModelRefreshController({
      check: (knownRevision, signal) =>
        lambdaClient.modelCatalog.check.query({ knownRevision }, { signal }),
      apply: (response, signal) =>
        useAiInfraStore
          .getState()
          .applySilentModelCatalog(response.models, response.revision, userId, signal),
      clear: (refreshRuntime) => useAiInfraStore.getState().clearSilentModelCatalog(refreshRuntime),
    });
    controller.start();
    return () => {
      controller.stop();
      useAiInfraStore.getState().clearSilentModelCatalog();
    };
  }, [ready, userId]);
  return null;
});
export default SilentModelRefresh;
