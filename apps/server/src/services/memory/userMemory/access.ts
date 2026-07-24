import { AgentModel } from '@/database/models/agent';
import { UserModel } from '@/database/models/user';
import { type LobeChatDatabase } from '@/database/type';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

interface PersonalMemoryAccessInput {
  runtimeEnabled: boolean;
  userEnabled: boolean;
  workspaceId?: string | null;
}

export const hasPersonalMemoryAccess = ({
  runtimeEnabled,
  userEnabled,
  workspaceId,
}: PersonalMemoryAccessInput): boolean =>
  !workspaceId && runtimeEnabled === true && userEnabled === true;

export const isPersonalMemoryEnabled = async ({
  db,
  userId,
  workspaceId,
}: {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}): Promise<boolean> => {
  if (workspaceId) return false;

  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  if (featureFlags.enableMemory !== true) return false;

  const settings = await new UserModel(db, userId).getUserSettings();
  const memorySettings = settings?.memory as { enabled?: boolean } | undefined;

  return hasPersonalMemoryAccess({
    runtimeEnabled: true,
    userEnabled: memorySettings?.enabled === true,
    workspaceId,
  });
};

export const isAgentPersonalMemoryEnabled = async ({
  agentId,
  db,
  userId,
  workspaceId,
}: {
  agentId: string;
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}): Promise<boolean> => {
  if (!(await isPersonalMemoryEnabled({ db, userId, workspaceId }))) return false;

  const agent = await new AgentModel(db, userId, workspaceId ?? undefined).getAgentConfigById(
    agentId,
  );

  return Boolean(agent && agent.chatConfig?.memory?.enabled !== false);
};
