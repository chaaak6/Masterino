import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sandboxService = {
    callTool: vi.fn(),
    capabilities: {
      backgroundCommands: true,
      exportFile: true,
      files: true,
      languages: ['python'],
      persistentSession: true,
      shell: true,
      skillScripts: true,
    },
    exportAndUploadFile: vi.fn(),
    kind: 'onlyboxes',
  };

  return {
    checkHash: vi.fn(),
    createSandboxService: vi.fn(() => sandboxService),
    deviceExecuteToolCall: vi.fn(),
    deviceVerifySkillPaths: vi.fn(),
    prepareSkillPackage: vi.fn(),
    executeProjectSkillRpc: vi.fn(),
    fileService: {
      getFullFileUrl: vi.fn(),
    },
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    getAgentSkills: vi.fn(),
    getUserSettings: vi.fn(),
    getSandboxProviderKind: vi.fn(() => 'onlyboxes'),
    marketService: {},
    marketServiceConstructor: vi.fn(),
    queryMessages: vi.fn(),
    readResource: vi.fn(),
    sandboxService,
  };
});

vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [],
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn(() => ({
    findAll: mocks.findAll,
    findById: mocks.findById,
    findByName: mocks.findByName,
  })),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({ query: mocks.queryMessages })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    checkHash: mocks.checkHash,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({
    getUserSettings: mocks.getUserSettings,
  })),
}));

vi.mock('@/helpers/skillFilters', () => ({
  filterBuiltinSkills: vi.fn((skills: unknown) => skills),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeToolCall: mocks.deviceExecuteToolCall,
    verifySkillPaths: mocks.deviceVerifySkillPaths,
    prepareSkillPackage: mocks.prepareSkillPackage,
    executeProjectSkillRpc: mocks.executeProjectSkillRpc,
  },
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(() => ({
    getAgentSkills: mocks.getAgentSkills,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => mocks.fileService),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: mocks.marketServiceConstructor.mockImplementation(() => mocks.marketService),
}));

vi.mock('@/server/services/sandbox', async () => {
  const actual = await vi.importActual('@/server/services/sandbox');

  return {
    ...(actual as Record<string, unknown>),
    createSandboxService: mocks.createSandboxService,
    getSandboxProviderKind: mocks.getSandboxProviderKind,
  };
});

vi.mock('@/server/services/skill/resource', () => ({
  SkillResourceService: vi.fn(() => ({
    readResource: mocks.readResource,
  })),
}));

const activation = (id: string, name: string) => ({
  role: 'tool',
  plugin: { identifier: 'lobe-skills', apiName: 'activateSkill' },
  pluginState: { id, name },
});

describe('skillsRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.checkHash.mockResolvedValue({ isExist: true, url: 'skills/user-skill.zip' });
    mocks.fileService.getFullFileUrl.mockResolvedValue('https://files.example.com/user-skill.zip');
    mocks.executeProjectSkillRpc.mockResolvedValue({
      directory: '/cache/extracted/deploy',
      content: 'body',
      files: ['SKILL.md'],
    });
    mocks.findAll.mockResolvedValue({ data: [], total: 0 });
    mocks.findById.mockResolvedValue(undefined);
    mocks.findByName.mockImplementation(async (name: string) => {
      if (name === 'user-skill') {
        return {
          id: 'user-skill-id',
          name: 'user-skill',
          zipFileHash: 'zip-hash-1',
        };
      }

      return undefined;
    });
    mocks.getAgentSkills.mockResolvedValue([]);
    mocks.queryMessages.mockResolvedValue([activation('project:deploy', 'deploy')]);
    mocks.getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
    mocks.deviceVerifySkillPaths.mockImplementation(async ({ skillDir, workspaceRoot }) => ({
      skillDir,
      workspaceRoot,
    }));
    mocks.deviceExecuteToolCall.mockResolvedValue({
      content: 'ok',
      state: { exitCode: 0, output: 'device ok', success: true },
      success: true,
    });
    mocks.sandboxService.callTool.mockResolvedValue({
      result: {
        exitCode: 0,
        output: 'ok',
        stdout: 'ok',
        success: true,
      },
      success: true,
    });
  });

  it('executes scripts through the sandbox service and only attaches persisted skill zips', async () => {
    const userSkill = {
      id: 'user-skill-id',
      identifier: 'user-skill',
      name: 'user-skill',
      zipFileHash: 'zip-hash-1',
    };
    mocks.queryMessages.mockResolvedValue([
      {
        ...activation('user:user-skill', 'user-skill'),
        pluginState: { id: 'user:user-skill', name: 'user-skill', resourceVersion: 'zip-hash-1' },
      },
    ]);
    mocks.findAll.mockResolvedValue({ data: [userSkill], total: 1 });
    mocks.findById.mockResolvedValue(userSkill);
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      skillRegistryResult: {
        skills: [
          {
            key: 'user:user-skill',
            identifier: 'user-skill',
            name: 'user-skill',
            description: '',
            source: 'user',
            scope: 'personal',
            zipFileHash: 'zip-hash-1',
          },
        ],
      } as never,
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await runtime.execScript({
      activatedSkills: [
        { id: 'user-skill-id', name: 'user-skill' },
        { id: 'builtin-skill-id', name: 'builtin-skill' },
      ],
      command: 'python scripts/run.py',
      description: 'Run skill script',
    });

    expect(result.success).toBe(true);
    expect(mocks.getUserSettings).not.toHaveBeenCalled();
    expect(mocks.marketServiceConstructor).not.toHaveBeenCalled();
    expect(mocks.findByName).not.toHaveBeenCalled();
    expect(mocks.findById).toHaveBeenCalledWith('user-skill-id');
    expect(mocks.checkHash).toHaveBeenCalledWith('zip-hash-1');
    expect(mocks.sandboxService.callTool).toHaveBeenCalledWith(
      'execScript',
      expect.objectContaining({
        command: 'python scripts/run.py',
        description: 'Run skill script',
        skillZipUrls: {
          'user-skill': 'https://files.example.com/user-skill.zip',
        },
      }),
    );
  }, 60_000);

  it('injects the frozen device context, verifies paths, and never creates a sandbox', async () => {
    mocks.queryMessages.mockResolvedValue([activation('project:workspace-1:deploy', 'deploy')]);
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      activeDeviceId: 'device-1',
      executionContext: {
        cwd: '/repo',
        env: { secretKeys: [], sources: {}, values: { TOKEN: 'value' } },
        plan: { deviceId: 'device-1', kind: 'device', target: 'device' },
        version: 1,
        workspace: {
          deviceId: 'device-1',
          id: 'workspace-1',
          kind: 'device',
          rootPath: '/repo',
        },
      },
      operationId: 'operation-1',
      projectSkills: [{ location: '/repo/.agents/skills/deploy/SKILL.md', name: 'deploy' }],
      serverDB: {} as never,
      skillRegistryResult: {
        entries: [],
        errors: [],
        policy: {
          includeAgentSkills: true,
          includeProjectSkills: true,
          includeUserSkills: true,
          materializeForHeteroCli: 'off',
          pinned: [],
        },
        precedence: { agent: 200, builtin: 100, project: 400, user: 300, workspace: 350 },
        skills: [
          {
            description: 'Deploy',
            identifier: 'project:deploy',
            key: 'project:workspace-1:deploy',
            location: '/repo/.agents/skills/deploy/SKILL.md',
            name: 'deploy',
            scope: 'project',
            source: 'project',
          },
        ],
      },
      toolCallId: 'tool-call-1',
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await runtime.execScript({
      activatedSkills: [{ id: 'project:deploy', name: 'deploy' }],
      command: './scripts/deploy.sh',
      description: 'Deploy',
    });

    expect(result).toMatchObject({ success: true });
    expect(mocks.deviceVerifySkillPaths).toHaveBeenCalledWith({
      deviceId: 'device-1',
      skillDir: '/cache/extracted/deploy',
      userId: 'user-1',
      workspaceRoot: '/repo',
    });
    expect(mocks.deviceExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-1',
        executionContext: expect.objectContaining({
          cwd: '/repo',
          env: {
            SKILL_DIR: '/cache/extracted/deploy',
            TOKEN: 'value',
            WORKSPACE_DIR: '/repo',
          },
          workspaceRootPath: '/repo',
        }),
        operationId: 'operation-1',
        toolCallId: 'tool-call-1',
      }),
      expect.objectContaining({ apiName: 'runCommand', identifier: 'lobe-local-system' }),
      undefined,
    );
    expect(mocks.createSandboxService).not.toHaveBeenCalled();
  });

  it('prepares a user ZIP from persisted activations on the frozen device before executing its script', async () => {
    mocks.queryMessages.mockResolvedValue([
      {
        ...activation('user:user-skill', 'user-skill'),
        pluginState: { id: 'user:user-skill', name: 'user-skill', resourceVersion: 'hash-1' },
      },
    ]);
    mocks.findAll.mockResolvedValue({
      data: [{ id: 'skill-1', identifier: 'user-skill' }],
      total: 1,
    });
    const { skillsRuntime } = await import('../skills');
    mocks.findById.mockImplementation(async (id: string) =>
      id === 'skill-1'
        ? { id, identifier: 'user-skill', name: 'user-skill', zipFileHash: 'hash-1' }
        : undefined,
    );
    mocks.prepareSkillPackage.mockResolvedValue({ extractedDir: '/cache/skills/hash-1' });
    mocks.deviceVerifySkillPaths.mockResolvedValue({
      skillDir: '/cache/skills/hash-1',
      workspaceRoot: '/repo',
    });
    mocks.deviceExecuteToolCall.mockResolvedValue({ content: 'ok', success: true });
    const runtime = await skillsRuntime.factory({
      skillRegistryResult: {
        skills: [
          {
            key: 'user:user-skill',
            identifier: 'user-skill',
            name: 'user-skill',
            description: '',
            source: 'user',
            scope: 'personal',
            zipFileHash: 'hash-1',
          },
        ],
      } as never,
      activeDeviceId: 'device-1',
      toolManifestMap: {},
      userId: 'user-1',
      serverDB: {} as any,
      operationId: 'operation-1',
      topicId: 'topic-1',
      toolCallId: 'call-1',
      projectSkills: [{ location: '/repo/.agents/skills/old/SKILL.md', name: 'old-project' }],
      executionContext: {
        version: 1,
        operationId: 'operation-1',
        plan: { kind: 'device', target: 'device', deviceId: 'device-1' },
        cwd: '/repo',
        workspace: { id: 'workspace-1', deviceId: 'device-1', kind: 'device', rootPath: '/repo' },
        envFiles: ['.env'],
      },
    });
    expect(
      (
        await runtime.execScript({
          command: 'python scripts/check.py',
          description: 'check',
          activatedSkills: [{ id: 'forged', name: 'not-activated' }],
        })
      ).success,
    ).toBe(true);
    expect(mocks.prepareSkillPackage).toHaveBeenCalledWith({
      deviceId: 'device-1',
      userId: 'user-1',
      zipHash: 'hash-1',
      url: 'https://files.example.com/user-skill.zip',
    });
    expect(mocks.deviceExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          cwd: '/repo',
          workspaceRootPath: '/repo',
          envFiles: ['.env'],
        }),
      }),
      expect.anything(),
      undefined,
    );
    expect(mocks.createSandboxService).not.toHaveBeenCalled();
  });

  it('fails closed when device path verification is unavailable', async () => {
    mocks.queryMessages.mockResolvedValue([activation('project:workspace-1:deploy', 'deploy')]);
    mocks.deviceVerifySkillPaths.mockResolvedValue(undefined);
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      activeDeviceId: 'device-1',
      topicId: 'topic-1',
      operationId: 'operation-1',
      executionContext: {
        cwd: '/repo',
        plan: { deviceId: 'device-1', kind: 'device', target: 'device' },
        version: 1,
        workspace: {
          deviceId: 'device-1',
          id: 'workspace-1',
          kind: 'device',
          rootPath: '/repo',
        },
      },
      projectSkills: [{ location: '/repo/.agents/skills/deploy/SKILL.md', name: 'deploy' }],
      serverDB: {} as never,
      skillRegistryResult: {
        entries: [],
        errors: [],
        policy: {
          includeAgentSkills: true,
          includeProjectSkills: true,
          includeUserSkills: true,
          materializeForHeteroCli: 'off',
          pinned: [],
        },
        precedence: { agent: 200, builtin: 100, project: 400, user: 300, workspace: 350 },
        skills: [
          {
            description: 'Deploy',
            identifier: 'project:deploy',
            key: 'project:workspace-1:deploy',
            location: '/repo/.agents/skills/deploy/SKILL.md',
            name: 'deploy',
            scope: 'project',
            source: 'project',
          },
        ],
      },
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.execScript({
      activatedSkills: [{ id: 'project:workspace-1:deploy', name: 'deploy' }],
      command: './scripts/deploy.sh',
      description: 'Deploy',
    });

    expect(result).toMatchObject({ state: { errorCode: 'WORKSPACE_REQUIRED' }, success: false });
    expect(mocks.deviceExecuteToolCall).not.toHaveBeenCalled();
    expect(mocks.createSandboxService).not.toHaveBeenCalled();
  });
  it('revalidates the ZIP version at the real sandbox adapter before package preparation', async () => {
    const skill = {
      id: 'db-1',
      identifier: 'demo',
      name: 'demo',
      content: 'body',
      zipFileHash: 'zip-v1',
    };
    mocks.queryMessages.mockResolvedValue([
      {
        ...activation('user:demo', 'demo'),
        pluginState: { id: 'user:demo', name: 'demo', resourceVersion: 'zip-v1' },
      },
    ]);
    mocks.findAll.mockResolvedValue({ data: [skill], total: 1 });
    mocks.findById
      .mockResolvedValueOnce(skill)
      .mockResolvedValue({ ...skill, zipFileHash: 'zip-v2' });
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
      skillRegistryResult: {
        skills: [
          {
            key: 'user:demo',
            identifier: 'demo',
            name: 'demo',
            description: '',
            source: 'user',
            scope: 'personal',
            zipFileHash: 'zip-v1',
          },
        ],
      } as never,
    });
    const result = await runtime.execScript({
      skillId: 'user:demo',
      command: 'python script.py',
      description: '',
    });
    expect(result.success).toBe(false);
    expect(result.content).toContain('SKILL_RESOURCE_VERSION_CHANGED');
    expect(mocks.checkHash).not.toHaveBeenCalled();
    expect(mocks.sandboxService.callTool).not.toHaveBeenCalled();
  });

  it('rejects a disabled user key even when a same-name builtin is available', async () => {
    mocks.queryMessages.mockResolvedValue([
      {
        ...activation('user:demo', 'demo'),
        pluginState: { id: 'user:demo', name: 'demo', resourceVersion: 'v1' },
      },
    ]);
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
      skillRegistryResult: {
        skills: [
          {
            key: 'builtin:demo',
            identifier: 'demo',
            name: 'demo',
            description: '',
            source: 'builtin',
            scope: 'builtin',
          },
        ],
      } as never,
    });
    expect(
      (
        await runtime.execScript({
          skillId: 'user:demo',
          command: 'python script.py',
          description: '',
        })
      ).success,
    ).toBe(false);
    expect(mocks.sandboxService.callTool).not.toHaveBeenCalled();
    expect(mocks.prepareSkillPackage).not.toHaveBeenCalled();
  });
});
