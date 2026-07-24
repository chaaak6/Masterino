import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasPersonalMemoryAccess, isPersonalMemoryEnabled } from '../access';

const { mockGetFeatureFlags, mockGetUserSettings } = vi.hoisted(() => ({
  mockGetFeatureFlags: vi.fn(),
  mockGetUserSettings: vi.fn(),
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
});
