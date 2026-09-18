// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { projectWorkspaces, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ProjectWorkspaceModel } from '../projectWorkspace';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'project-workspace-unc-user';

beforeEach(async () => {
  await serverDB.delete(projectWorkspaces).where(eq(projectWorkspaces.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
});

describe('ProjectWorkspaceModel', () => {
  it('persists and deduplicates a Windows UNC workspace without losing its network prefix', async () => {
    const model = new ProjectWorkspaceModel(serverDB, userId);

    const created = await model.getOrCreate({
      deviceId: 'device-a',
      kind: 'device',
      rootPath: '\\\\BSFSPRD02\\biel\\personal disks\\10360515\\AI AGENT\\',
    });
    const reopened = await model.getOrCreate({
      deviceId: 'device-a',
      kind: 'device',
      rootPath: '//BSFSPRD02/biel/personal disks/10360515/AI AGENT/',
    });

    expect(created).toMatchObject({
      displayName: 'AI AGENT',
      rootPath: '//BSFSPRD02/biel/personal disks/10360515/AI AGENT',
      scopeKey: 'device:device-a://BSFSPRD02/biel/personal disks/10360515/AI AGENT',
    });
    expect(reopened.id).toBe(created.id);
    await expect(model.list({ deviceId: 'device-a' })).resolves.toHaveLength(1);
  });
});
