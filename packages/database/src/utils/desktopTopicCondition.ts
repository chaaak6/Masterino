import { sql } from 'drizzle-orm';

import { projectWorkspaces, topics } from '../schemas';

/**
 * Desktop visibility must constrain both rows and counts before LIMIT/OFFSET.
 * Local projects and scratch directories stay on their owning device.
 * Account-scoped sandboxes and ordinary chats can appear on multiple devices.
 */
export const desktopTopicCondition = (deviceId?: string) => {
  if (deviceId === undefined) return undefined;
  const metadata = topics.metadata;
  const workspaceId = sql`coalesce(nullif(${metadata}->'executionSnapshot'->>'workspaceId', ''), nullif(${metadata}->>'workspaceId', ''))`;
  const workspaceField = (
    field: typeof projectWorkspaces.deviceId | typeof projectWorkspaces.kind,
  ) => sql`(
    select ${field} from ${projectWorkspaces}
    where ${projectWorkspaces.id} = ${workspaceId}
      and ${projectWorkspaces.userId} = ${topics.userId}
  )`;
  const owner = workspaceField(projectWorkspaces.deviceId);
  const kind = sql`coalesce(${metadata}->'executionSnapshot'->>'workspaceKind', ${workspaceField(projectWorkspaces.kind)}, ${metadata}->>'workspaceKind')`;
  const device = sql`coalesce(${metadata}->'executionSnapshot'->>'boundDeviceId', ${owner}, ${metadata}->>'boundDeviceId')`;
  return sql`(
    ${kind} = 'sandbox'
    or (
      ${kind} is distinct from 'scratch'
      and ${workspaceId} is null and nullif(${metadata}->>'workingDirectory', '') is null
    )
    or (${device} = ${deviceId} and (${owner} is null or ${owner} = ${deviceId}))
  )`;
};
