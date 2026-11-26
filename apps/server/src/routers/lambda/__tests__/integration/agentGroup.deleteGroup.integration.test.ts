// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, topics } from '@lobechat/database/schemas';
import { closeTestDB, getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { agentGroupRouter } from '../../agentGroup';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

beforeAll(async () => {
  testDB = await getTestDB();
});

afterAll(closeTestDB);

it('deleting a group removes its virtual supervisor and retains an unlinked virtual member', async () => {
  const userId = await createTestUser(testDB);
  try {
    const caller = agentGroupRouter.createCaller({ jwtPayload: { userId }, userId });
    const { agentIds, groupId, supervisorAgentId } = await caller.createGroupWithMembers({
      groupConfig: { title: 'Group deletion regression' },
      members: [{ title: 'Member' }],
    });
    const [memberAgentId] = agentIds;
    const [topic] = await testDB
      .insert(topics)
      .values({ groupId, userId })
      .returning({ id: topics.id });

    await expect(
      caller.checkAgentsBeforeRemoval({ agentIds: [memberAgentId], groupId }),
    ).resolves.toEqual({ nonVirtualAgentIds: [memberAgentId], virtualAgents: [] });
    await expect(
      caller.removeAgentsFromGroup({ agentIds: [memberAgentId], groupId }),
    ).resolves.toEqual({ deletedVirtualAgentIds: [], removedFromGroup: 1 });
    const findGroupTopic = () => testDB.query.topics.findFirst({ where: eq(topics.id, topic.id) });
    await expect(findGroupTopic()).resolves.toMatchObject({ groupId });
    const deleted = await caller.deleteGroup({ id: groupId });
    expect(deleted.deletedVirtualAgentIds).toEqual([supervisorAgentId]);
    await expect(findGroupTopic()).resolves.toBeUndefined();

    const identities = await testDB.query.agents.findMany({
      columns: { id: true },
      where: inArray(agents.id, [memberAgentId, supervisorAgentId]),
    });
    expect(identities).toEqual([{ id: memberAgentId }]);
  } finally {
    await cleanupTestUser(testDB, userId);
  }
});
