import {
  type SkillRuntimeService,
  SkillsExecutionRuntime,
} from '@lobechat/builtin-tool-skills/executionRuntime';
import type { SkillItem } from '@lobechat/types';
import type { SkillProvider, SkillRef } from '@lobechat/types/src/projectWorkspace';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopSkillRuntimeService } from '@/services/electron/desktopSkillRuntime';
import { localFileService } from '@/services/electron/localFileService';
import { agentSkillService } from '@/services/skill';
import { getToolStoreState } from '@/store/tool';

import { resolveClientSkills } from './skillEngineering';

vi.mock('@/store/tool', () => ({
  getToolStoreState: vi.fn(),
}));

vi.mock('@/services/skill', () => ({
  agentSkillService: {
    getById: vi.fn(),
    getZipUrl: vi.fn(),
  },
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: { prepareSkillDirectory: vi.fn() },
}));

// Keep all skills available in the test environment.
vi.mock('@/helpers/toolAvailability', () => ({
  isBuiltinSkillAvailableInCurrentEnv: () => true,
}));

const mockedGetToolStoreState = vi.mocked(getToolStoreState);
const mockedGetById = vi.mocked(agentSkillService.getById);

const setToolState = (state: any) => {
  mockedGetToolStoreState.mockReturnValue({
    agentSkillDetailMap: {},
    agentSkills: [],
    builtinSkills: [],
    ...state,
  } as any);
};

const findSkill = (
  skills: { activated?: boolean; content?: string; identifier: string }[],
  identifier: string,
) => skills.find((s) => s.identifier === identifier);

describe('resolveClientSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carries builtin skill content so pinned builtin skills can be injected', async () => {
    setToolState({
      builtinSkills: [
        {
          content: '<artifacts_guide>build UI</artifacts_guide>',
          description: 'Generate interactive UI',
          identifier: 'artifacts',
          name: 'Artifacts',
          source: 'builtin',
        },
      ],
    });

    const result = await resolveClientSkills(['artifacts']);

    expect(result.enabledPluginIds).toEqual(['artifacts']);
    // activated must be set so SkillContextProvider injects content directly
    // (the MessagesEngine path consumes these metas without running SkillResolver).
    expect(findSkill(result.skills, 'artifacts')).toMatchObject({
      activated: true,
      content: '<artifacts_guide>build UI</artifacts_guide>',
      identifier: 'artifacts',
    });
  });

  it('fetches DB skill content for pinned skills', async () => {
    setToolState({
      agentSkills: [
        { description: 'A user skill', id: 'db-1', identifier: 'my-skill', name: 'My Skill' },
      ],
    });
    mockedGetById.mockResolvedValue({
      content: 'full skill body',
      id: 'db-1',
      identifier: 'my-skill',
      name: 'My Skill',
    } as any);

    const result = await resolveClientSkills(['my-skill']);

    expect(mockedGetById).toHaveBeenCalledWith('db-1');
    expect(findSkill(result.skills, 'my-skill')).toMatchObject({
      activated: true,
      content: 'full skill body',
      identifier: 'my-skill',
    });
  });

  it('appends the resource tree to pinned DB skill content', async () => {
    setToolState({
      agentSkills: [{ description: '', id: 'db-1', identifier: 'my-skill', name: 'My Skill' }],
    });
    mockedGetById.mockResolvedValue({
      content: 'body',
      id: 'db-1',
      identifier: 'my-skill',
      name: 'My Skill',
      resources: { 'kb/readme.md': { fileHash: 'h', size: 1 } },
    } as any);

    const result = await resolveClientSkills(['my-skill']);

    const skill = findSkill(result.skills, 'my-skill');
    expect(skill?.content).toContain('body');
    // resourcesTreePrompt output references the resource tree
    expect(skill?.content).toContain('Available Resources');
    expect(skill?.content).toContain('readme.md');
    expect(skill?.content).toContain('id="user:my-skill"');
    expect(skill?.content).not.toContain('id="My Skill"');
    expect(skill?.content).not.toContain('skillName=');
  });

  it('does NOT fetch content for non-pinned DB skills (auto mode bulk exposure)', async () => {
    setToolState({
      agentSkills: [
        { description: 'A user skill', id: 'db-1', identifier: 'my-skill', name: 'My Skill' },
      ],
    });

    // pluginIds empty => skill is exposed (available list) but not pinned
    const result = await resolveClientSkills([]);

    expect(mockedGetById).not.toHaveBeenCalled();
    const skill = findSkill(result.skills, 'my-skill');
    expect(skill?.content).toBeUndefined();
    expect(skill?.activated).toBeFalsy();
  });

  it('does NOT pre-activate a pinned DB skill bundled as a ZIP', async () => {
    // Bundled skills must go through activateSkill so the server mounts the bundle;
    // pre-injecting content here would reference scripts/resources that are not mounted.
    setToolState({
      agentSkills: [
        {
          description: 'bundled',
          id: 'db-1',
          identifier: 'zip-skill',
          name: 'Zip Skill',
          zipFileHash: 'hash-abc',
        },
      ],
    });

    const result = await resolveClientSkills(['zip-skill']);

    expect(mockedGetById).not.toHaveBeenCalled();
    const skill = findSkill(result.skills, 'zip-skill');
    expect(skill?.content).toBeUndefined();
    expect(skill?.activated).toBeFalsy();
  });

  it('prefers the cached skill detail over a network fetch', async () => {
    setToolState({
      agentSkillDetailMap: {
        'db-1': { content: 'cached body', id: 'db-1', identifier: 'my-skill', name: 'My Skill' },
      },
      agentSkills: [{ description: '', id: 'db-1', identifier: 'my-skill', name: 'My Skill' }],
    });

    const result = await resolveClientSkills(['my-skill']);

    expect(mockedGetById).not.toHaveBeenCalled();
    expect(findSkill(result.skills, 'my-skill')).toMatchObject({
      activated: true,
      content: 'cached body',
    });
  });

  it('degrades gracefully when a pinned DB skill content fetch fails', async () => {
    setToolState({
      agentSkills: [{ description: '', id: 'db-1', identifier: 'my-skill', name: 'My Skill' }],
    });
    mockedGetById.mockRejectedValue(new Error('network down'));

    const result = await resolveClientSkills(['my-skill']);

    // No throw; skill still listed (available, not activated), just without content.
    const skill = findSkill(result.skills, 'my-skill');
    expect(skill).toMatchObject({ identifier: 'my-skill' });
    expect(skill?.content).toBeUndefined();
    expect(skill?.activated).toBeFalsy();
  });

  it('uses registry precedence so a user skill shadows a same-named builtin', async () => {
    setToolState({
      agentSkills: [
        { description: 'user version', id: 'db-1', identifier: 'user-deploy', name: 'Deploy' },
      ],
      builtinSkills: [
        {
          content: 'builtin version',
          description: 'builtin version',
          identifier: 'builtin-deploy',
          name: 'Deploy',
          source: 'builtin',
        },
      ],
    });

    const result = await resolveClientSkills([]);

    expect(result.skills.map(({ identifier }) => identifier)).toEqual(['user-deploy']);
    expect(result.registry?.entries).toEqual([
      expect.objectContaining({ status: 'available' }),
      expect.objectContaining({ shadowedBy: 'user:user-deploy', status: 'shadowed' }),
    ]);
  });

  it('merges accepted project context and an explicit agent provider into one registry', async () => {
    setToolState({});
    const agentProvider: SkillProvider & { source: 'agent' } = {
      list: async (context) => [
        {
          content: 'agent instructions',
          description: 'Agent-local review',
          identifier: 'agent-review',
          key: `agent:${context.agentId}:review`,
          name: 'review',
          ownerId: context.agentId,
          scope: 'personal',
          source: 'agent',
        },
      ],
      source: 'agent',
    };

    const result = await resolveClientSkills([], {
      agentProvider,
      skillContext: {
        agentId: 'agent-7',
        skillPolicy: {
          includeAgentSkills: true,
          includeProjectSkills: true,
          includeUserSkills: true,
        },
        userId: 'user-7',
        workspace: { id: 'workspace-7', kind: 'device', rootPath: '/repo' },
        workspaceInit: {
          instructions: [],
          skills: [
            {
              description: 'Project deployment',
              name: 'deploy',
              path: '/repo/.agents/skills/deploy/SKILL.md',
            },
          ],
        },
      },
    });

    expect(
      result.registry?.entries.filter(({ status }) => status === 'available').map(({ ref }) => ref),
    ).toEqual([
      expect.objectContaining({
        identifier: 'project:deploy',
        location: '/repo/.agents/skills/deploy/SKILL.md',
        ownerId: 'workspace-7',
        source: 'project',
      }),
      expect.objectContaining({
        identifier: 'agent-review',
        ownerId: 'agent-7',
        source: 'agent',
      }),
    ]);
  });
});

it('preserves the user ZIP version from client projection through Runtime into the desktop adapter', async () => {
  const skill: SkillItem = {
    createdAt: new Date(0),
    updatedAt: new Date(0),
    manifest: { name: 'Zip Demo', description: 'Demo' },
    source: 'user',
    id: 'db-zip',
    identifier: 'zip-demo',
    name: 'Zip Demo',
    description: '',
    content: 'body',
    zipFileHash: 'hash-current',
  };
  setToolState({ agentSkills: [skill] });
  mockedGetById.mockResolvedValue(skill as never);
  vi.mocked(agentSkillService.getZipUrl).mockResolvedValue({
    url: 'https://files.example/demo.zip',
  } as never);
  vi.mocked(localFileService.prepareSkillDirectory).mockResolvedValue({
    success: true,
    extractedDir: '/prepared/demo',
  } as never);
  // This is the actual projection persisted by streamingExecutor as operation.skills.
  const operation = await resolveClientSkills([]);
  const projected = operation.skills.find((entry) => entry.identifier === skill.identifier)!;
  expect(projected.zipFileHash).toBe('hash-current');
  const execute = vi.fn<NonNullable<SkillRuntimeService['execScript']>>(
    async (_command, options) => {
      expect(
        await desktopSkillRuntimeService.resolveExecutionDirectory(options.activatedSkills),
      ).toBe('/prepared/demo');
      return { success: true, exitCode: 0, output: 'adapter reached' };
    },
  );
  const runtime = new SkillsExecutionRuntime({
    registryResult: { skills: operation.skills as SkillRef[] },
    service: {
      findAll: async () => ({ data: [skill], total: 1 }),
      findById: async () => skill,
      findByName: async () => undefined,
      readResource: vi.fn(),
      execScript: execute,
    },
  });
  const args = { command: 'python scripts/demo.py', description: '', skillId: projected.key! };
  for (const resourceVersion of [undefined, 'hash-old']) {
    expect(
      (
        await runtime.execScript({
          ...args,
          activatedSkills: [{ id: projected.key!, name: skill.name, resourceVersion }],
        })
      ).success,
    ).toBe(false);
  }
  expect(localFileService.prepareSkillDirectory).not.toHaveBeenCalled();
  const activation = await runtime.activateSkill({ name: projected.key! });
  expect(activation.state).toMatchObject({ id: projected.key, resourceVersion: 'hash-current' });
  expect(
    (
      await runtime.execScript({
        ...args,
        activatedSkills: [
          {
            id: activation.state!.id,
            name: skill.name,
            resourceVersion: activation.state!.resourceVersion,
          },
        ],
      })
    ).success,
  ).toBe(true);
  expect(execute).toHaveBeenCalledOnce();
  expect(localFileService.prepareSkillDirectory).toHaveBeenCalledWith({
    url: 'https://files.example/demo.zip',
    zipHash: 'hash-current',
  });
});
