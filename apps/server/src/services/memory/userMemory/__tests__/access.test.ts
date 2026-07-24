import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasPersonalMemoryAccess,
  isAgentPersonalMemoryEnabled,
  isPersonalMemoryEnabled,
} from '../access';

const { mockGetAgentConfigById, mockGetFeatureFlags, mockGetUserSettings } = vi.hoisted(() => ({
  mockGetAgentConfigById: vi.fn(),
  mockGetFeatureFlags: vi.fn(),
  mockGetUserSettings: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({ getAgentConfigById: mockGetAgentConfigById })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({ getUserSettings: mockGetUserSettings })),
}));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mockGetFeatureFlags,
}));

describe('personal memory access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentConfigById.mockResolvedValue({ chatConfig: {} });
    mockGetFeatureFlags.mockResolvedValue({ enableMemory: true });
    mockGetUserSettings.mockResolvedValue({ memory: { enabled: true } });
  });

  it.each([
    {
      expected: false,
      input: { runtimeEnabled: false, userEnabled: true },
      name: 'runtime rollout is disabled',
    },
    {
      expected: false,
      input: { runtimeEnabled: true, userEnabled: false },
      name: 'user has not consented',
    },
    {
      expected: false,
      input: { runtimeEnabled: true, userEnabled: true, workspaceId: 'workspace-1' },
      name: 'request is workspace scoped',
    },
    {
      expected: true,
      input: { runtimeEnabled: true, userEnabled: true },
      name: 'runtime and explicit user consent are enabled in personal space',
    },
  ])('returns $expected when $name', ({ expected, input }) => {
    expect(hasPersonalMemoryAccess(input)).toBe(expected);
  });

  it('short-circuits workspace access before loading flags or settings', async () => {
    await expect(
      isPersonalMemoryEnabled({
        db: {} as any,
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).resolves.toBe(false);

    expect(mockGetFeatureFlags).not.toHaveBeenCalled();
    expect(mockGetUserSettings).not.toHaveBeenCalled();
  });

  it('requires an enabled runtime rollout', async () => {
    mockGetFeatureFlags.mockResolvedValue({ enableMemory: false });

    await expect(isPersonalMemoryEnabled({ db: {} as any, userId: 'user-1' })).resolves.toBe(false);

    expect(mockGetUserSettings).not.toHaveBeenCalled();
  });

  it('requires explicit user consent', async () => {
    mockGetUserSettings.mockResolvedValue({ memory: { enabled: false } });

    await expect(isPersonalMemoryEnabled({ db: {} as any, userId: 'user-1' })).resolves.toBe(false);
  });

  it('allows explicitly enabled personal memory', async () => {
    await expect(isPersonalMemoryEnabled({ db: {} as any, userId: 'user-1' })).resolves.toBe(true);
  });

  it('allows an agent to opt out after the personal gate succeeds', async () => {
    mockGetAgentConfigById.mockResolvedValue({ chatConfig: { memory: { enabled: false } } });

    await expect(
      isAgentPersonalMemoryEnabled({
        agentId: 'agent-1',
        db: {} as any,
        userId: 'user-1',
      }),
    ).resolves.toBe(false);
  });

  it('does not load an agent when the personal gate is disabled', async () => {
    mockGetUserSettings.mockResolvedValue({ memory: { enabled: false } });

    await expect(
      isAgentPersonalMemoryEnabled({
        agentId: 'agent-1',
        db: {} as any,
        userId: 'user-1',
      }),
    ).resolves.toBe(false);

    expect(mockGetAgentConfigById).not.toHaveBeenCalled();
  });

  it('enables memory for an existing agent unless that agent explicitly opts out', async () => {
    await expect(
      isAgentPersonalMemoryEnabled({
        agentId: 'agent-1',
        db: {} as any,
        userId: 'user-1',
      }),
    ).resolves.toBe(true);

    expect(mockGetAgentConfigById).toHaveBeenCalledWith('agent-1');
  });
});
