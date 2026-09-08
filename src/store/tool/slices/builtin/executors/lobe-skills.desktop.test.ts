import { selectActivatedSkillsFromMessages } from '@lobechat/builtin-tool-skills';
import type { BuiltinToolContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { skillsExecutor } from './lobe-skills.desktop';

const { executeLocalToolCall, resolveExecutionDirectory, resolveRealPath } = vi.hoisted(() => ({
  executeLocalToolCall: vi.fn(),
  resolveExecutionDirectory: vi.fn(),
  resolveRealPath: vi.fn(),
}));

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { executeLocalToolCall },
}));
vi.mock('@/services/electron/desktopSkillRuntime', () => ({
  desktopSkillRuntimeService: {
    resolveExecutionDirectory,
    resolveReferenceFullPath: vi.fn(),
  },
}));
vi.mock('@/services/electron/localFileService', () => ({
  localFileService: { resolveRealPath },
}));
vi.mock('@/services/skill', () => ({
  agentSkillService: {
    getById: vi.fn(),
    getByName: vi.fn(),
    list: vi.fn(),
    readResource: vi.fn(),
  },
}));

const context = {
  agentId: 'agent-a',
  executionContext: {
    accessRoots: [
      {
        modes: ['read', 'write', 'exec'],
        rootPath: '/workspace/project',
        scope: 'primary',
        source: 'workspace',
      },
    ],
    cwd: '/workspace/project',
    envFiles: ['.env'],
    operationId: 'operation-a',
    plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
    version: 1,
    workspace: {
      deviceId: 'device-a',
      id: 'workspace-a',
      kind: 'device',
      rootPath: '/workspace/project',
    },
  },
  messageId: 'message-a',
  operationId: 'operation-a',
  toolCallId: 'call-a',
  topicId: 'topic-a',
} satisfies BuiltinToolContext;

describe('desktop skills execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeLocalToolCall.mockResolvedValue({ content: 'ok', success: true });
    resolveRealPath.mockImplementation(async ({ path }: { path: string }) => ({
      path,
      success: true,
    }));
  });

  it('activates and reads references using frozen project file access', async () => {
    const skill = {
      description: 'test',
      identifier: 'demo',
      key: 'project:workspace-a:demo',
      location: '/workspace/project/.agents/skills/demo/SKILL.md',
      name: 'demo',
      scope: 'project' as const,
      source: 'project' as const,
    };
    const ctx = { ...context, operationSkills: [skill] };
    executeLocalToolCall.mockImplementation(async ({ apiName, args }) => {
      if (apiName === 'prepareProjectSkillSnapshot') {
        if (args.resourcePath?.startsWith('../')) throw new Error('DENIED_SCOPE');
        return {
          content: 'Prepared',
          success: true,
          state: {
            result: {
              content: 'Frozen project instructions',
              hash: 'snapshot-v1',
              directory: '/managed/project-snapshot',
              files: ['references/readme.md', 'scripts/probe.sh'],
              resourceContent: args.resourcePath ? 'Reference content' : undefined,
            },
          },
        };
      }
      return { content: 'Script ran', success: true };
    });
    const activation = await skillsExecutor.activateSkill({ name: 'demo' }, ctx);
    expect(activation.success).toBe(true);
    const activatedSkills = selectActivatedSkillsFromMessages([
      {
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: activation.state,
        role: 'tool',
      },
    ]);
    expect(activatedSkills).toEqual([
      expect.objectContaining({ id: 'project:workspace-a:demo', name: 'demo' }),
    ]);
    expect(
      (
        await skillsExecutor.execScript(
          {
            skillId: skill.key,
            command: 'sh "$SKILL_DIR/scripts/probe.sh"',
            description: 'Run the project probe',
          },
          {
            ...ctx,
            stepContext: { activatedSkills },
          },
        )
      ).success,
    ).toBe(true);
    expect(executeLocalToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'runCommand',
        executionContext: expect.objectContaining({
          cwd: '/workspace/project',
          env: expect.objectContaining({ SKILL_DIR: '/managed/project-snapshot' }),
          workspaceRootPath: '/workspace/project',
          envFiles: ['.env'],
        }),
      }),
    );
    expect(
      (await skillsExecutor.readReference({ id: skill.key, path: 'references/readme.md' }, ctx))
        .success,
    ).toBe(true);
    expect(executeLocalToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'prepareProjectSkillSnapshot',
        args: expect.objectContaining({
          skillId: skill.key,
          resourcePath: 'references/readme.md',
        }),
        trace: expect.objectContaining({ deviceId: 'device-a', operationId: 'operation-a' }),
      }),
    );
    executeLocalToolCall.mockClear();
    expect(
      (await skillsExecutor.readReference({ id: 'demo', path: '../secret' }, ctx)).success,
    ).toBe(false);
    expect(executeLocalToolCall).not.toHaveBeenCalled();
  });

  it('runs a general skill command in the frozen workspace through main process', async () => {
    await skillsExecutor.runCommand({ command: 'pwd' }, context);

    expect(executeLocalToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'runCommand',
        executionContext: expect.objectContaining({
          cwd: '/workspace/project',
          envRef: {
            agentId: 'agent-a',
            topicId: 'topic-a',
            workspaceId: 'workspace-a',
          },
          workspaceRootPath: '/workspace/project',
        }),
        purpose: 'skill-command',
      }),
    );
  });

  it('runs an activated skill script with its prepared resource and frozen workspace', async () => {
    resolveExecutionDirectory.mockResolvedValue('/managed/skills/hash-a');

    await skillsExecutor.execScript(
      { command: 'sh "$SKILL_DIR/run.sh"', description: 'run it' },
      {
        ...context,
        stepContext: {
          activatedSkills: [{ id: 'skill-a', name: 'skill-a' }],
        },
      },
    );

    expect(executeLocalToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'runCommand',
        executionContext: expect.objectContaining({
          cwd: '/workspace/project',
          env: expect.objectContaining({ SKILL_DIR: '/managed/skills/hash-a' }),
          workspaceRootPath: '/workspace/project',
        }),
        purpose: 'skill-script',
      }),
    );
  });
});
