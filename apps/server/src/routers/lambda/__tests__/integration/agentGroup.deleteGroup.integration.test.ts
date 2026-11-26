// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { inArray } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';

import { agentGroupRouter } from '../../agentGroup';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

it('deleting a group removes its virtual supervisor and retains an unlinked virtual member', async () => {
  testDB = await getTestDB();
  const userId = await createTestUser(testDB);
  try {
    const caller = agentGroupRouter.createCaller({ jwtPayload: { userId }, userId });
    const { agentIds, groupId, supervisorAgentId } = await caller.createGroupWithMembers({
      groupConfig: { title: 'Group deletion regression' },
      members: [{ title: 'Member' }],
    });
    const [memberAgentId] = agentIds;

    await expect(
      caller.removeAgentsFromGroup({ agentIds: [memberAgentId], groupId }),
    ).resolves.toEqual({ deletedVirtualAgentIds: [], removedFromGroup: 1 });
    const deleted = await caller.deleteGroup({ id: groupId });
    expect(deleted.deletedVirtualAgentIds).toEqual([supervisorAgentId]);

    const identities = await testDB.query.agents.findMany({
      columns: { id: true },
      where: inArray(agents.id, [memberAgentId, supervisorAgentId]),
    });
    expect(identities).toEqual([{ id: memberAgentId }]);
  } finally {
    await cleanupTestUser(testDB, userId);
  }
});
