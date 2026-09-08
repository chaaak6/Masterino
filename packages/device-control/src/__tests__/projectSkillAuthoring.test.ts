import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectSkillOnDevice,
  deleteProjectSkillOnDevice,
  packProjectSkillOnDevice,
  recoverProjectSkillEdit,
  renameProjectSkillOnDevice,
  updateProjectSkillOnDevice,
  validateProjectSkillOnDevice,
} from '../projectSkillAuthoring';

// Native ESM exports cannot be spied on; expose a test wrapper while retaining real I/O.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
}));

const content = (name: string) =>
  `---\nname: ${name}\ndescription: Maintain ${name}\n---\n\n# ${name}\n\nFollow the checklist.`;

describe('device project skill authoring', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'project-skill-authoring-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it.each(['file', 'directory', 'dangling'])(
    'rejects a nested %s symlink without changing the published skill',
    async (kind) => {
      await createProjectSkillOnDevice({ content: content('safe'), name: 'safe', scope: root });
      const dir = path.join(root, '.agents/skills/safe');
      const outside = path.join(root, 'outside');
      await mkdir(outside);
      await writeFile(path.join(outside, 'original.md'), 'unchanged');
      await mkdir(path.join(dir, 'references/nested'), { recursive: true });
      const target =
        kind === 'directory'
          ? outside
          : path.join(outside, kind === 'file' ? 'original.md' : 'missing');
      await symlink(target, path.join(dir, 'references/nested/link'));
      await expect(
        updateProjectSkillOnDevice({ name: 'safe', scope: root, path: 'new.md', content: 'new' }),
      ).rejects.toThrow('SCOPE_DENIED');
      expect(await readFile(path.join(dir, 'SKILL.md'), 'utf8')).toBe(content('safe'));
      expect(await readFile(path.join(outside, 'original.md'), 'utf8')).toBe('unchanged');
      await expect(readFile(path.join(dir, 'new.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await validateProjectSkillOnDevice({ name: 'safe', scope: root })).valid).toBe(false);
    },
  );

  it('refuses delete while a real staged edit holds the authoring lock', async () => {
    await createProjectSkillOnDevice({ content: content('safe'), name: 'safe', scope: root });
    const dir = path.join(root, '.agents/skills/safe');
    const realCopy = fs.cp;
    let resume!: () => void;
    let copied!: () => void;
    const held = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const reachedCopy = new Promise<void>((resolve) => {
      copied = resolve;
    });
    vi.spyOn(fs, 'cp').mockImplementationOnce(async (...args) => {
      await realCopy(...args);
      copied();
      await held;
    });
    const edit = updateProjectSkillOnDevice({
      name: 'safe',
      scope: root,
      path: 'new.md',
      content: 'new',
    });
    try {
      await reachedCopy;
      await expect(deleteProjectSkillOnDevice({ name: 'safe', scope: root })).rejects.toThrow(
        'SKILL_EDIT_IN_PROGRESS',
      );
      expect(await readFile(path.join(dir, 'SKILL.md'), 'utf8')).toBe(content('safe'));
    } finally {
      resume();
    }
    await expect(edit).resolves.toMatchObject({ valid: true });
    expect(await readFile(path.join(dir, 'new.md'), 'utf8')).toBe('new');
    await deleteProjectSkillOnDevice({ name: 'safe', scope: root });
    await expect(readFile(path.join(dir, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('holds the same lock until deletion has removed the published directory', async () => {
    await createProjectSkillOnDevice({ content: content('safe'), name: 'safe', scope: root });
    const dir = path.join(root, '.agents/skills/safe');
    const realRename = fs.rename;
    let resume!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const reachedRename = new Promise<void>((resolve) => {
      reached = resolve;
    });
    vi.spyOn(fs, 'rename').mockImplementationOnce(async (...args) => {
      reached();
      await held;
      await realRename(...args);
    });
    const deletion = deleteProjectSkillOnDevice({ name: 'safe', scope: root });
    try {
      await reachedRename;
      await expect(
        updateProjectSkillOnDevice({ name: 'safe', scope: root, path: 'new.md', content: 'new' }),
      ).rejects.toThrow('SKILL_EDIT_IN_PROGRESS');
      expect(await readFile(path.join(dir, 'SKILL.md'), 'utf8')).toBe(content('safe'));
    } finally {
      resume();
    }
    await deletion;
    await expect(readFile(path.join(dir, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(path.join(root, '.agents/skills'))).toEqual([]);
  });
});
