import { isDesktop } from '@lobechat/const';
import { type ToolManifest } from '@lobechat/types';
import useSWR from 'swr';

import { useEffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';
import { electronKeys } from '@/libs/swr/keys';
import { getDeviceLocalMcpManifests } from '@/services/deviceLocalMcp';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';

import { type InsertActionTagPayload } from '../InputEditor/ActionTag/command';
import { useChatInputStore } from '../store';

export const createLocalMcpTag = (manifest: ToolManifest): InsertActionTagPayload => ({
  category: 'tool',
  label: manifest.meta?.title ?? manifest.identifier,
  type: manifest.identifier,
});

export const useDeviceLocalMcpPicker = (agentId: string, isHetero: boolean) => {
  const topicId = useChatInputStore((s) => s.topicId);
  const workspace = useEffectiveWorkspace(agentId, { topicId });
  const userId = useUserStore((s) => (s.isSignedIn ? s.user?.id : undefined));
  const serverUrl = useElectronStore((s) => s.dataSyncConfig?.remoteServerUrl);
  // External agents resolve MCP through their own runtime rather than these desktop manifests.
  const key =
    isDesktop &&
    !isHetero &&
    userId &&
    !workspace.loading &&
    workspace.context.plan.target === 'local'
      ? electronKeys.deviceLocalMcp(userId, serverUrl)
      : null;
  const { data, error, mutate } = useSWR(key, () =>
    getDeviceLocalMcpManifests(workspace.context, userId),
  );

  return {
    loadError: key ? Boolean(error) : false,
    manifests: key ? data : undefined,
    reload: mutate,
    workspace,
  };
};
