// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRouter } from './agent';

const { mockMarketSDK, mockCreateAgentVersionHeader, mockMarketUserInfoValue } = vi.hoisted(() => {
  const mockCreateAgentVersionHeader = vi.fn();
  const mockMarketUserInfoValue = {
    current: { email: 'actor@example.com', name: 'Actor', userId: 'user-1' } as any,
  };
  const mockMarketSDK = {
    agents: {
      createAgent: vi.fn(),
      createAgentVersion: vi.fn(async () => {
        mockCreateAgentVersionHeader(mockMarketSDK.headers['x-lobe-owner-account-id']);
        return { success: true };
      }),
      getAgentDetail: vi.fn(),
    },
    headers: {} as Record<string, string>,
  };

  return { mockCreateAgentVersionHeader, mockMarketSDK, mockMarketUserInfoValue };
});

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({
    getUserState: vi.fn(async () => ({ settings: {} })),
  })),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  marketSDK: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        marketSDK: mockMarketSDK,
      },
    }),
  ),
  marketUserInfo: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        marketUserInfo: mockMarketUserInfoValue.current,
      },
    }),
  ),
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn(() => 'trust-token'),
}));

describe('agentRouter.publishOrCreate', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMarketSDK.headers = {};
    mockMarketUserInfoValue.current = {
      email: 'actor@example.com',
      name: 'Actor',
      userId: 'user-1',
    };
    mockMarketSDK.agents.getAgentDetail.mockResolvedValue({
      identifier: 'existing-agent',
      name: 'Existing Agent',
      ownerId: 123,
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ accountId: 999, sub: 'user-1' }), {
        status: 200,
      }),
    );
  });

  it('returns builtin onboarding agents when no market auth exists', async () => {
    mockMarketUserInfoValue.current = undefined;
    const caller = agentRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    const result = await caller.getOnboardingFull({ locale: 'zh-CN' });

    expect(Object.keys(result).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses the acting organization account for ownership checks and version uploads', async () => {
    const caller = agentRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    const result = await caller.publishOrCreate({
      actAs: 123,
      identifier: 'existing-agent',
      name: 'Existing Agent',
    });

    expect(result).toEqual({
      identifier: 'existing-agent',
      isNewAgent: false,
      success: true,
    });
    expect(mockMarketSDK.agents.createAgent).not.toHaveBeenCalled();
    expect(mockMarketSDK.agents.createAgentVersion).toHaveBeenCalledWith({
      identifier: 'existing-agent',
      name: 'Existing Agent',
    });
    expect(mockCreateAgentVersionHeader).toHaveBeenCalledWith('123');
    expect(mockMarketSDK.headers['x-lobe-owner-account-id']).toBeUndefined();
  });
});
