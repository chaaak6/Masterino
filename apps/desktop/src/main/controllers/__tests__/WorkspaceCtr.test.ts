import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type App } from '@/core/App';

import WorkspaceCtr from '../WorkspaceCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

const mockLocalFileProtocolManager = {
  approveIndexedProjectRoot: vi.fn(),
};

const mockApp = {
  localFileProtocolManager: mockLocalFileProtocolManager,
} as unknown as App;

const frontmatter = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\nbody`;

describe('WorkspaceCtr', () => {
  let projectRoot: string;
  let workspaceCtr: WorkspaceCtr;

  const createSkill = async (
    source: '.agents/skills' | '.claude/skills',
    name: string,
    description: string,
  ) => {
    const skillDir = path.join(projectRoot, source, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), frontmatter(name, description));
    return skillDir;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    projectRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'workspace-ctr-')));
    workspaceCtr = new WorkspaceCtr(mockApp);
  });

  afterEach(async () => {
    await rm(projectRoot, { force: true, recursive: true });
  });

  describe('initWorkspace', () => {
    it('merges skills from both sources and reads instruction files', async () => {
      await createSkill('.agents/skills', 'spa-routes', 'SPA routing');
      await createSkill('.claude/skills', 'reviewer', 'Code review');
      await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Agents');
      await writeFile(path.join(projectRoot, 'CLAUDE.md'), '# Claude');

      const result = await workspaceCtr.initWorkspace({ scope: projectRoot });

      expect(result.skills.map((s) => s.name)).toEqual(['reviewer', 'spa-routes']);
      expect(result.instructions).toEqual([
        { content: '# Agents', source: 'AGENTS.md' },
        { content: '# Claude', source: 'CLAUDE.md' },
      ]);
      expect(mockLocalFileProtocolManager.approveIndexedProjectRoot).toHaveBeenCalledWith(
        projectRoot,
      );
    });

    it('dedupes skills by name with .agents/skills winning', async () => {
      await createSkill('.agents/skills', 'shared', 'from agents');
      await createSkill('.claude/skills', 'shared', 'from claude');

      const result = await workspaceCtr.initWorkspace({ scope: projectRoot });

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]).toMatchObject({
        description: 'from agents',
        path: path.join(projectRoot, '.agents/skills/shared/SKILL.md'),
      });
    });

    it('caps instruction file content', async () => {
      const huge = 'x'.repeat(100 * 1024);
      await writeFile(path.join(projectRoot, 'AGENTS.md'), huge);

      const result = await workspaceCtr.initWorkspace({ scope: projectRoot });

      expect(result.skills).toEqual([]);
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].content.length).toBe(64 * 1024);
    });

    it('returns empty skills and instructions when nothing is present', async () => {
      const result = await workspaceCtr.initWorkspace({ scope: projectRoot });

      expect(result).toEqual({ instructions: [], root: projectRoot, skills: [] });
    });
  });

  describe('listProjectSkills', () => {
    it('merges both sources while keeping .agents first', async () => {
      await createSkill('.agents/skills', 'alpha', 'A');
      await createSkill('.claude/skills', 'ignored', 'Ignored');

      const result = await workspaceCtr.listProjectSkills({ scope: projectRoot });

      expect(result.source).toBe('.agents/skills');
      expect(result.skills.map((s) => s.name)).toEqual(['alpha', 'ignored']);
    });

    it('returns empty + null source when no skills exist', async () => {
      const result = await workspaceCtr.listProjectSkills({ scope: projectRoot });

      expect(result).toEqual({ root: projectRoot, skills: [], source: null });
    });
  });
});
