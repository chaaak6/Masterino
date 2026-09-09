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
  mocks.factory.mockResolvedValue({ execScript: mocks.execute, activateSkill: mocks.execute });
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

const allowedKey = 'project:workspace-a:demo';
const activationBinding = () => ({
  args: { name: 'demo' },
  context: {
    operationId: 'operation',
    toolCallId: 'tool-call',
    skillRegistryResult: { skills: [{ key: allowedKey, identifier: 'demo' }] },
  },
});

it.each([undefined, '', 'demo', 'project:workspace-b:demo', 'user:demo'])(
  'desktop activation rejects a successful response with invalid key %s before returning it',
  async (key) => {
    const { marketRouter } = await import('./market');
    mocks.resolve.mockResolvedValue(activationBinding());
    mocks.execute.mockResolvedValue({
      success: true,
      content: 'Rejected private Skill instructions',
      deferred: true,
      state: { id: key, name: 'demo', resourceVersion: 'private-version' },
    });
    const caller = marketRouter.createCaller({ userId: 'user', serverDB: {} } as never);
    const result = await caller.executeSkillTool({
      apiName: 'activateSkill',
      messageId: 'message',
      topicId: 'topic',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'SKILL_ACTIVATION_IDENTITY_MISMATCH' },
      state: { errorCode: 'SKILL_ACTIVATION_IDENTITY_MISMATCH' },
    });
    expect(result.deferred).toBeUndefined();
    expect(result.state.id).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private');
  },
);

it('desktop activation preserves the exact allowed key and content', async () => {
  const { marketRouter } = await import('./market');
  mocks.resolve.mockResolvedValue(activationBinding());
  const success = {
    success: true,
    content: 'instructions',
    state: { id: allowedKey, name: 'demo' },
  };
  mocks.execute.mockResolvedValue(success);
  const caller = marketRouter.createCaller({ userId: 'user', serverDB: {} } as never);
  expect(
    await caller.executeSkillTool({
      apiName: 'activateSkill',
      messageId: 'message',
      topicId: 'topic',
    }),
  ).toEqual(success);
  expect(mocks.execute).toHaveBeenCalledWith({ name: 'demo' });
});

it('desktop activation rejects a key when the allowed registry is empty', async () => {
  const { marketRouter } = await import('./market');
  const binding = activationBinding();
  binding.context.skillRegistryResult.skills = [];
  mocks.resolve.mockResolvedValue(binding);
  mocks.execute.mockResolvedValue({
    success: true,
    content: 'instructions',
    state: { id: allowedKey },
  });
  const caller = marketRouter.createCaller({ userId: 'user', serverDB: {} } as never);
  expect(
    await caller.executeSkillTool({
      apiName: 'activateSkill',
      messageId: 'message',
      topicId: 'topic',
    }),
  ).toMatchObject({ success: false, error: { type: 'SKILL_ACTIVATION_IDENTITY_MISMATCH' } });
});

it('desktop activation retains the original runtime failure', async () => {
  const { marketRouter } = await import('./market');
  mocks.resolve.mockResolvedValue(activationBinding());
  const failure = {
    success: false,
    content: 'resource unavailable',
    error: { type: 'RESOURCE_ERROR' },
  };
  mocks.execute.mockResolvedValue(failure);
  const caller = marketRouter.createCaller({ userId: 'user', serverDB: {} } as never);
  expect(
    await caller.executeSkillTool({
      apiName: 'activateSkill',
      messageId: 'message',
      topicId: 'topic',
    }),
  ).toEqual(failure);
});
