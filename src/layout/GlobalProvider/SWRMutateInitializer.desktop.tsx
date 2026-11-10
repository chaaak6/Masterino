'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { type PropsWithChildren, useEffect } from 'react';
import { useSWRConfig } from 'swr';

import { setScopedMutate } from '@/libs/swr';
import { electronKeys } from '@/libs/swr/keys';
import { remoteServerService } from '@/services/electron/remoteServer';
import { useElectronStore } from '@/store/electron';

/**
 * Initialize scoped mutate for use outside React components (e.g., Zustand stores)
 * Desktop variant: also listens to Electron IPC for remote server config updates
 */
const SWRMutateInitializer = ({ children }: PropsWithChildren) => {
  const { mutate } = useSWRConfig();
  const useInitElectronAppState = useElectronStore((s) => s.useInitElectronAppState);
  useInitElectronAppState();

  useEffect(() => {
    setScopedMutate(mutate);
  }, [mutate]);

  useWatchBroadcast('remoteServerConfigUpdated', async () => {
    try {
      const config = await remoteServerService.getRemoteServerConfig();
      if (!config.active) {
        // Revoked native credentials must not revalidate mounted account caches.
        await mutate(electronKeys.remoteServerConfig());
        return;
      }
      await mutate(() => true, undefined, { revalidate: true });
    } catch {
      // Ignore: SWR cache may not be ready yet in early boot.
    }
  });

  return <>{children}</>;
};

export default SWRMutateInitializer;
