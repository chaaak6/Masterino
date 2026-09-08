import { describe, expect, it, vi } from 'vitest';

import { type SkillRuntimeService, SkillsExecutionRuntime } from './index';

const service = (): SkillRuntimeService => ({
  findAll: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findById: vi.fn().mockResolvedValue(undefined),
  findByName: vi.fn().mockResolvedValue(undefined),
  readResource: vi.fn(),
  execScript: vi.fn(),
});
const project = {
  key: 'project:workspace-a:report',
  identifier: 'project:report',
  name: 'report',
  description: 'Reporting',
  scope: 'project' as const,
  source: 'project' as const,
  location: '/work/.agents/skills/report/SKILL.md',
};

describe('operation skill identity', () => {
  it('uses the returned project ID to read a reference without a name roundtrip', async () => {
    const readFile = vi.fn(async (path: string) =>
      path.endsWith('SKILL.md') ? '# Report' : 'reference',
    );
    const runtime = new SkillsExecutionRuntime({
      service: service(),
      registryResult: { skills: [project] },
      deviceFileAccess: { readFile, listFiles: async () => ['SKILL.md', 'reference.md'] },
    });
    const activated = await runtime.activateSkill({ name: 'report' });
    expect(activated.state?.id).toBe(project.key);
    const result = await runtime.readReference({
      id: String(activated.state?.id),
      path: 'reference.md',
    });
    expect(result).toMatchObject({ success: true, content: 'reference' });
    expect(readFile).toHaveBeenLastCalledWith('/work/.agents/skills/report/reference.md');
  });

  it.each([{ skills: [] }, { skills: [project] }])(
    'rejects disabled or same-name foreign-workspace history before execution',
    async ({ skills }) => {
      const backend = service();
      const prepare = vi.fn();
      const runtime = new SkillsExecutionRuntime({
        service: backend,
        registryResult: { skills },
        skillDirectoryResolver: prepare,
      });
      const result = await runtime.execScript({
        command: 'echo forbidden',
        description: 'test',
        skillId: 'project:workspace-b:report',
        activatedSkills: [{ id: 'project:workspace-b:report', name: 'report' }],
      });
      expect(result.success).toBe(false);
      expect(prepare).not.toHaveBeenCalled();
      expect(backend.execScript).not.toHaveBeenCalled();
    },
  );

  it('builtin activation returns an ID that reads its bundled reference', async () => {
    const runtime = new SkillsExecutionRuntime({
      service: service(),
      registryResult: {
        skills: [
          {
            ...project,
            key: 'builtin:report',
            identifier: 'report',
            source: 'builtin',
            scope: 'builtin',
          },
        ],
      },
      builtinSkills: [
        {
          identifier: 'report',
          name: 'report',
          description: '',
          content: '# Guide',
          resources: { 'ref.md': { content: 'bundled', size: 7, fileHash: 'fixture-hash' } },
        },
      ],
    });
    const activation = await runtime.activateSkill({ name: 'report' });
    const result = await runtime.readReference({
      id: String(activation.state?.id),
      path: 'ref.md',
    });
    expect(result).toMatchObject({ success: true, content: 'bundled' });
  });
});
