import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import type { NewApiBridgeClient } from '@/server/services/newApi/bridgeClient';

import { UserAvailabilityService } from './userAvailabilityService';

const createFixture = (binding?: {
  managedTokenId: number;
  newApiUserId: number;
  status: string;
}) => {
  const db = {
    query: {
      aiModels: {
        findMany: vi.fn().mockResolvedValue([{ id: 'chat-model', updatedAt: new Date() }]),
      },
      enterpriseUserProfiles: {
        findFirst: vi.fn().mockResolvedValue({ employeeNumber: 'MTEST10020' }),
      },
      newApiBindings: { findFirst: vi.fn().mockResolvedValue(binding) },
      users: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'user-test', fullName: 'Test User', banned: false }),
      },
    },
  };
  const bridge = {
    findUserById: vi.fn().mockResolvedValue({ id: 2664, username: 'MTEST10020', status: 1 }),
    inspectBoundToken: vi.fn().mockResolvedValue({
      availability: 'disabled',
      token: {
        id: 4893,
        key: 'unexpected-key',
        name: 'Masterino_MTEST10020',
        status: 2,
        user_id: 2664,
      },
    }),
    isEnabled: vi.fn().mockReturnValue(true),
    updateBoundToken: vi.fn().mockResolvedValue({
      availability: 'active',
      token: {
        id: 4893,
        key: 'unexpected-key',
        name: 'Masterino_MTEST10020',
        status: 1,
        user_id: 2664,
      },
    }),
  };
  const service = new UserAvailabilityService(
    db as unknown as LobeChatDatabase,
    bridge as unknown as NewApiBridgeClient,
  );
  return { bridge, db, service };
};

describe('UserAvailabilityService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows disabled bound tokens even when the Aihub account is enabled', async () => {
    const { service } = createFixture({
      managedTokenId: 4893,
      newApiUserId: 2664,
      status: 'active',
    });

    const result = await service.getUser('user-test');

    expect(result.aihub?.status).toBe(1);
    expect(result.token.status).toBe('disabled');
    expect(result.health).toBe('blocked');
    expect(result.token.inspection?.token).not.toHaveProperty('key');
  });

  it('does not mark a pending binding or an account without chat models as usable', async () => {
    const pending = createFixture({ managedTokenId: 4893, newApiUserId: 2664, status: 'pending' });
    pending.bridge.inspectBoundToken.mockResolvedValue({
      availability: 'active',
      token: { id: 4893 },
    });
    expect((await pending.service.getUser('user-test')).health).toBe('blocked');

    const noModels = createFixture({ managedTokenId: 4893, newApiUserId: 2664, status: 'active' });
    noModels.bridge.inspectBoundToken.mockResolvedValue({
      availability: 'active',
      token: { id: 4893 },
    });
    noModels.db.query.aiModels.findMany.mockResolvedValue([]);
    expect((await noModels.service.getUser('user-test')).health).toBe('blocked');
  });

  it('does not query Aihub for a user without a binding', async () => {
    const { bridge, service } = createFixture();

    const result = await service.getUser('user-test');

    expect(result.health).toBe('uninitialized');
    expect(bridge.inspectBoundToken).not.toHaveBeenCalled();
  });

  it('edits only the IDs read from the Masterino binding and redacts the response', async () => {
    const { bridge, service } = createFixture({
      managedTokenId: 4893,
      newApiUserId: 2664,
      status: 'active',
    });

    const result = await service.updateBoundToken('user-test', { status: 1 });

    expect(bridge.updateBoundToken).toHaveBeenCalledWith(2664, 4893, { status: 1 });
    expect(result.token).not.toHaveProperty('key');
  });

  it('refuses an owner mismatch rather than reporting a successful edit', async () => {
    const { bridge, service } = createFixture({
      managedTokenId: 4893,
      newApiUserId: 2664,
      status: 'active',
    });
    bridge.updateBoundToken.mockResolvedValue({ availability: 'owner_mismatch' });

    await expect(service.updateBoundToken('user-test', { status: 1 })).rejects.toThrow(
      'owner_mismatch',
    );
  });
});
