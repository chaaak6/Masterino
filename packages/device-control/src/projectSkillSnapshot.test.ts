// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { prepareProjectSkillSnapshot } from './projectSkillSnapshot';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it('pins body, reference and script for an operation, refreshes only a new operation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skill-snapshot-'));
  folders.push(root);
  const source = path.join(root, 'workspace', '.agents', 'skills', 'demo');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'SKILL.md'), 'old body');
  await writeFile(path.join(source, 'reference.md'), 'old reference');
  await writeFile(path.join(source, 'run.py'), 'print("old")');
  const input = {
    operationId: 'op1',
    skillId: 'project:workspace:demo',
    path: path.join(source, 'SKILL.md'),
    workspaceRoot: path.join(root, 'workspace'),
  };
  const cache = path.join(root, 'cache');
  const first = await prepareProjectSkillSnapshot(input, cache);
  await writeFile(path.join(source, 'SKILL.md'), 'new body');
  await writeFile(path.join(source, 'reference.md'), 'new reference');
  await writeFile(path.join(source, 'run.py'), 'print("new")');
  const again = await prepareProjectSkillSnapshot(
    { ...input, resourcePath: 'reference.md' },
    cache,
  );
  expect(again.directory).toBe(first.directory);
  expect(again.content).toBe('old body');
  expect(again.resourceContent).toBe('old reference');
  expect(await readFile(path.join(again.directory, 'run.py'), 'utf8')).toBe('print("old")');
  expect((await prepareProjectSkillSnapshot({ ...input, operationId: 'op2' }, cache)).content).toBe(
    'new body',
  );
  await expect(
    prepareProjectSkillSnapshot({ ...input, resourcePath: '../SKILL.md' }, cache),
  ).rejects.toThrow('RESOURCE_NOT_ALLOWED');
  await rm(source, { recursive: true });
  expect(
    (await prepareProjectSkillSnapshot({ ...input, resourcePath: 'reference.md' }, cache))
      .resourceContent,
  ).toBe('old reference');
});

it('rejects a symlinked skill directory on first preparation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skill-snapshot-link-'));
  folders.push(root);
  const source = path.join(root, 'real');
  await mkdir(source);
  await writeFile(path.join(source, 'SKILL.md'), 'body');
  await symlink(source, path.join(root, 'alias'));
  await expect(
    prepareProjectSkillSnapshot(
      {
        operationId: 'op',
        skillId: 'project:demo',
        path: path.join(root, 'alias', 'SKILL.md'),
        workspaceRoot: root,
      },
      path.join(root, 'cache'),
    ),
  ).rejects.toThrow('SKILL_SNAPSHOT_SYMLINK');
});
