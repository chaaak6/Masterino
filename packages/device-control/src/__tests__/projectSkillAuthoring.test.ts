import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  recoverProjectSkillEdit,
  createProjectSkillOnDevice,
  deleteProjectSkillOnDevice,
  packProjectSkillOnDevice,
  renameProjectSkillOnDevice,
  updateProjectSkillOnDevice,
  validateProjectSkillOnDevice,
} from '../projectSkillAuthoring';

const content = (name: string) =>
  `---\nname: ${name}\ndescription: Maintain ${name}\n---\n\n# ${name}\n\nFollow the checklist.`;

describe('device project skill authoring', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'project-skill-authoring-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('keeps the published skill unchanged when adding the 257th file fails validation', async () => {
    await createProjectSkillOnDevice({ content: content('safe'), name: 'safe', scope: root });
    const dir = path.join(root, '.agents/skills/safe');
    await Promise.all(
      Array.from({ length: 255 }, (_, index) => writeFile(path.join(dir, `${index}.md`), 'kept')),
    );
    const before = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
    await expect(
      updateProjectSkillOnDevice({ name: 'safe', scope: root, path: 'overflow.md', content: 'no' }),
    ).rejects.toThrow('256');
    expect(await readFile(path.join(dir, 'SKILL.md'), 'utf8')).toBe(before);
    await expect(readFile(path.join(dir, 'overflow.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await validateProjectSkillOnDevice({ name: 'safe', scope: root })).valid).toBe(true);
  }, 15000);

  it('does not rename an invalid skill before validating its replacement', async () => {
    await createProjectSkillOnDevice({ content: content('safe'), name: 'safe', scope: root });
    const dir = path.join(root, '.agents/skills/safe');
    await writeFile(path.join(dir, 'too-large.md'), 'x'.repeat(1024 * 1024 + 1));
    await expect(
      renameProjectSkillOnDevice({ name: 'safe', newName: 'renamed', scope: root }),
    ).rejects.toThrow('large');
    expect(await readFile(path.join(dir, 'SKILL.md'), 'utf8')).toBe(content('safe'));
    await expect(
      readFile(path.join(root, '.agents/skills/renamed/SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers the original after a process exits between directory renames', async () => {
    await createProjectSkillOnDevice({ content: content('safe'), name: 'safe', scope: root });
    const skills = path.join(root, '.agents/skills');
    const lock = path.join(skills, '.authoring-lock');
    await mkdir(lock);
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: exited.pid }));
    await writeFile(
      path.join(lock, 'transaction.json'),
      JSON.stringify({ original: 'safe', destination: 'renamed', stage: '.stage-recovery' }),
    );
    await rename(path.join(skills, 'safe'), path.join(lock, 'previous'));
    await recoverProjectSkillEdit(root);
    expect(await readFile(path.join(skills, 'safe/SKILL.md'), 'utf8')).toBe(content('safe'));
    await expect(readFile(path.join(skills, 'renamed/SKILL.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('creates, updates, renames, packs, validates, and deletes inside the workspace', async () => {
    await expect(
      createProjectSkillOnDevice({
        content: content('release-check'),
        name: 'release-check',
        scope: root,
      }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      updateProjectSkillOnDevice({
        content: '# Reference',
        name: 'release-check',
        path: 'references/checklist.md',
        scope: root,
      }),
    ).resolves.toMatchObject({ files: ['SKILL.md', 'references/checklist.md'], valid: true });

    await expect(
      renameProjectSkillOnDevice({ name: 'release-check', newName: 'ship-check', scope: root }),
    ).resolves.toMatchObject({ manifest: { name: 'ship-check' }, valid: true });
    expect(
      await readFile(path.join(root, '.agents', 'skills', 'ship-check', 'SKILL.md'), 'utf8'),
    ).toContain('name: ship-check');

    const packed = await packProjectSkillOnDevice({ name: 'ship-check', scope: root });
    expect(packed.size).toBeGreaterThan(0);
    expect(Buffer.from(packed.archiveBase64, 'base64').byteLength).toBe(packed.size);
    await expect(
      validateProjectSkillOnDevice({ name: 'ship-check', scope: root }),
    ).resolves.toMatchObject({ valid: true });

    await deleteProjectSkillOnDevice({ name: 'ship-check', scope: root });
    await expect(
      validateProjectSkillOnDevice({ name: 'ship-check', scope: root }),
    ).resolves.toMatchObject({ valid: false });
  });

  it('rejects traversal names and paths', async () => {
    await expect(
      createProjectSkillOnDevice({ content: content('safe'), name: '../safe', scope: root }),
    ).rejects.toThrow('INVALID_SKILL_NAME');
    await createProjectSkillOnDevice({ content: content('safe'), name: 'safe', scope: root });
    await expect(
      updateProjectSkillOnDevice({
        content: 'no',
        name: 'safe',
        path: '../outside.md',
        scope: root,
      }),
    ).rejects.toThrow('INVALID_SKILL_PATH');
  });

  it('rejects a symlinked skill directory without touching its target', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'project-skill-outside-'));
    await writeFile(path.join(outside, 'SKILL.md'), content('unsafe'));
    const skillsRoot = path.join(root, '.agents', 'skills');
    await mkdir(skillsRoot, { recursive: true });
    await symlink(outside, path.join(skillsRoot, 'unsafe'));

    await expect(
      updateProjectSkillOnDevice({
        content: 'changed',
        name: 'unsafe',
        path: 'references/file.md',
        scope: root,
      }),
    ).rejects.toThrow('SCOPE_DENIED');
    expect(await readFile(path.join(outside, 'SKILL.md'), 'utf8')).toBe(content('unsafe'));
    await rm(outside, { force: true, recursive: true });
  });
});
