import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

/**
 * Returns the effective memory enabled state for an agent.
 * The runtime rollout and user consent are hard gates. Agents may opt out,
 * but cannot opt a user into memory.
 */
export const useMemoryEnabled = (agentId: string): boolean => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const agentMemoryEnabled = useAgentStore(
    (s) => chatConfigByIdSelectors.getMemoryToolConfigById(agentId)(s)?.enabled,
  );
  const userMemoryEnabled = useUserStore(settingsSelectors.memoryEnabled);
  const { enableMemory } = useServerConfigStore(featureFlagsSelectors);

  return (
    !activeWorkspaceId && enableMemory === true && userMemoryEnabled && agentMemoryEnabled !== false
  );
};
