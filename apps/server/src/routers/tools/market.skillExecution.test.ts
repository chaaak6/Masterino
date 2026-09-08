// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), factory: vi.fn(), execute: vi.fn() }));
vi.mock('@/libs/trpc/lambda', async () => {
  const { initTRPC } = await import('@trpc/server');
  const t = initTRPC.context<any>().create();
  return { authedProcedure: t.procedure, router: t.router };
});
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => ({
  wsCompatProcedure: (await import('@/libs/trpc/lambda')).authedProcedure,
}));
vi.mock('@/libs/trpc/lambda/middleware', () => {
  const pass = ({ ctx, next }: any) => next({ ctx });
  return { serverDatabase: pass, telemetry: pass, marketUserInfo: pass };
});
vi.mock('@/libs/trpc/lambda/middleware/marketSDK', () => {
  const pass = ({ ctx, next }: any) => next({ ctx });
  return { marketSDK: pass, requireMarketAuth: pass };
});
vi.mock('@/database/models/user', () => ({ UserModel: vi.fn() }));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/server/services/market', () => ({ MarketService: vi.fn() }));
vi.mock('@/server/services/sandbox', () => ({
  getSandboxProviderKind: () => 'onlyboxes',
  createSandboxService: vi.fn(),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(() => ({ resolveClientSkillToolContext: mocks.resolve })),
}));
vi.mock('@/server/services/toolExecution/serverRuntimes/skills', () => ({
  skillsRuntime: { factory: mocks.factory },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.factory.mockResolvedValue({ execScript: mocks.execute });
});
it('the router runs only persisted server-resolved arguments through the shared runtime', async () => {
  const { marketRouter } = await import('./market');
  mocks.resolve.mockResolvedValue({
    args: { skillId: 'user:demo', command: 'python owned.py', description: 'run' },
    context: { marker: 'server-owned' },
  });
  mocks.execute.mockResolvedValue({ success: true, content: 'ok' });
  const caller = marketRouter.createCaller({ userId: 'user', serverDB: {} } as never);
  expect(
    await caller.executeSkillTool({
      apiName: 'execScript',
      messageId: 'message',
      topicId: 'topic',
    }),
  ).toMatchObject({ success: true });
  expect(mocks.resolve).toHaveBeenCalledWith({
    apiName: 'execScript',
    messageId: 'message',
    topicId: 'topic',
  });
  expect(mocks.factory).toHaveBeenCalledWith({ marker: 'server-owned' });
  expect(mocks.execute).toHaveBeenCalledWith({
    skillId: 'user:demo',
    command: 'python owned.py',
    description: 'run',
  });
});
it('the router does not reach a script adapter when owned-message verification fails', async () => {
  const { marketRouter } = await import('./market');
  mocks.resolve.mockRejectedValue(new Error('SKILL_TOOL_MESSAGE_NOT_OWNED'));
  const caller = marketRouter.createCaller({ userId: 'user', serverDB: {} } as never);
  await expect(
    caller.executeSkillTool({
      apiName: 'execScript',
      messageId: 'other-message',
      topicId: 'topic',
    }),
  ).rejects.toThrow('NOT_OWNED');
  expect(mocks.factory).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
});
