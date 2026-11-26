// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, chatGroupsAgents, messages, topics } from '@lobechat/database/schemas';
import { closeTestDB, getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
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

it('preserves another group’s shared member and historical agent when deleting a group', async () => {
  const userId = await createTestUser(testDB);
  try {
    const caller = agentGroupRouter.createCaller({ jwtPayload: { userId }, userId });
    const { agentIds, groupId, supervisorAgentId } = await caller.createGroupWithMembers({
      groupConfig: { title: 'Group to delete' },
      members: [
        { title: 'Shared virtual member' },
        { title: 'Historical member' },
        { title: 'Member addressed in a saved message' },
      ],
    });
    const [sharedId, historicalId, targetedId] = agentIds;
    const { groupId: otherGroupId } = await caller.createGroupWithMembers({
      groupConfig: { title: 'Group to keep' },
      members: [],
    });
    await caller.addAgentsToGroup({ agentIds: [sharedId, historicalId], groupId: otherGroupId });
    const [historicalTopic] = await testDB
      .insert(topics)
      .values({ agentId: historicalId, groupId: otherGroupId, userId })
      .returning({ id: topics.id });
    await caller.removeAgentsFromGroup({ agentIds: [historicalId], groupId: otherGroupId });
    await testDB.insert(messages).values({
      content: 'Addressed to a member who did not respond',
      groupId: otherGroupId,
      role: 'user',
      targetId: targetedId,
      topicId: historicalTopic.id,
      userId,
    });

    await expect(caller.deleteGroup({ id: groupId })).resolves.toMatchObject({
      deletedVirtualAgentIds: [supervisorAgentId],
    });
    await expect(
      testDB.query.chatGroupsAgents.findFirst({
        where: and(
          eq(chatGroupsAgents.chatGroupId, otherGroupId),
          eq(chatGroupsAgents.agentId, sharedId),
        ),
      }),
    ).resolves.toMatchObject({ agentId: sharedId });
    await expect(
      testDB.query.topics.findFirst({
        where: eq(topics.id, historicalTopic.id),
      }),
    ).resolves.toMatchObject({ agentId: historicalId });
    await expect(
      testDB.query.agents.findFirst({ where: eq(agents.id, targetedId) }),
    ).resolves.toMatchObject({ id: targetedId });
  } finally {
    await cleanupTestUser(testDB, userId);
  }
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
    await expect(caller.deleteGroup({ id: groupId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
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
