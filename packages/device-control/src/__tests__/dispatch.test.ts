import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { executeDeviceRpc } from '../dispatch';
import type { DeviceControlDeps } from '../types';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'device-control-'));
  await mkdir(path.join(root, '.agents', 'skills', 'spa-routes'), { recursive: true });
  await writeFile(
    path.join(root, '.agents', 'skills', 'spa-routes', 'SKILL.md'),
    '---\nname: spa-routes\ndescription: SPA routing\n---\nbody',
  );
  await writeFile(path.join(root, 'AGENTS.md'), '# Agents');
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

const makeDeps = (): DeviceControlDeps => ({
  approveProjectRoot: vi.fn(async () => {}),
  getLocalFilePreview: vi.fn(async () => ({ success: true })),
  getProjectFileIndex: vi.fn(async () => ({
    entries: [],
    indexedAt: '',
    root: '',
    source: 'glob' as const,
    totalCount: 0,
  })),
  scratchRoot: path.join(root, '.scratch-host'),
});

describe('executeDeviceRpc', () => {
  it('throws on an unknown method', async () => {
    await expect(executeDeviceRpc('nope', {}, makeDeps())).rejects.toThrow(
      'Unknown device RPC method: nope',
    );
  });

  it('routes initWorkspace through the shared workspace scan and approves the root', async () => {
    const deps = makeDeps();
    const result = (await executeDeviceRpc('initWorkspace', { scope: root }, deps)) as {
      instructions: { content: string; source: string }[];
      skills: { name: string }[];
    };

    expect(result.skills.map((s) => s.name)).toEqual(['spa-routes']);
    expect(result.instructions).toEqual([{ content: '# Agents', source: 'AGENTS.md' }]);
    expect(deps.approveProjectRoot).toHaveBeenCalledWith(root);
  });

  it('does not auto-read workspace instructions through a symlink outside the workspace', async () => {
    const scanRoot = await mkdtemp(path.join(tmpdir(), 'device-control-instructions-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'device-control-secret-'));

    try {
      const secret = path.join(outside, 'secret.md');
      await writeFile(secret, 'outside workspace secret');
      await symlink(secret, path.join(scanRoot, 'AGENTS.md'));

      const result = (await executeDeviceRpc('initWorkspace', { scope: scanRoot }, makeDeps())) as {
        instructions: { content: string; source: string }[];
      };

      expect(result.instructions).toEqual([]);
    } finally {
      await rm(scanRoot, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('does not auto-read project skills whose directory or SKILL.md escapes the workspace', async () => {
    const scanRoot = await mkdtemp(path.join(tmpdir(), 'device-control-skills-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'device-control-outside-skill-'));

    try {
      const skillSource = path.join(scanRoot, '.agents', 'skills');
      const insideSkill = path.join(skillSource, 'linked-file');
      await mkdir(insideSkill, { recursive: true });
      await writeFile(
        path.join(outside, 'SKILL.md'),
        '---\nname: escaped\ndescription: must not load\n---\nsecret',
      );
      await symlink(outside, path.join(skillSource, 'linked-directory'));
      await symlink(path.join(outside, 'SKILL.md'), path.join(insideSkill, 'SKILL.md'));

      const result = (await executeDeviceRpc('initWorkspace', { scope: scanRoot }, makeDeps())) as {
        skills: { name: string }[];
      };
      const listed = (await executeDeviceRpc(
        'listProjectSkills',
        { scope: scanRoot },
        makeDeps(),
      )) as { skills: { name: string }[] };

      expect(result.skills).toEqual([]);
      expect(listed.skills).toEqual([]);
    } finally {
      await rm(scanRoot, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('creates a stable scratch directory without allowing topic traversal', async () => {
    const first = (await executeDeviceRpc(
      'ensureScratchWorkspace',
      { topicId: '../../etc' },
      makeDeps(),
    )) as { root: string; topicSegment: string };
    const second = (await executeDeviceRpc(
      'ensureScratchWorkspace',
      { topicId: '../../etc' },
      makeDeps(),
    )) as { root: string; topicSegment: string };

    expect(second).toEqual(first);
    const realScratchRoot = await realpath(path.join(root, '.scratch-host'));
    expect(first.root.startsWith(realScratchRoot + path.sep)).toBe(true);
    expect(first.topicSegment).toMatch(/^topic-[a-f0-9]{32}$/);
  });

  it('does not create the scratch root unless ensureScratchWorkspace is called', async () => {
    const deps = { ...makeDeps(), scratchRoot: path.join(root, '.scratch-not-called') };
    await expect(access(deps.scratchRoot!)).rejects.toBeDefined();

    await executeDeviceRpc('statPath', { path: root }, deps);

    await expect(access(deps.scratchRoot!)).rejects.toBeDefined();
  });

  it('cleans only the deterministic topic scratch directory and is idempotent', async () => {
    const deps = makeDeps();
    const scratch = (await executeDeviceRpc(
      'ensureScratchWorkspace',
      { topicId: 'topic-cleanup' },
      deps,
    )) as { root: string };
    await writeFile(path.join(scratch.root, 'result.txt'), 'temporary');

    await expect(
      executeDeviceRpc('cleanupScratchWorkspace', { topicId: 'topic-cleanup' }, deps),
    ).resolves.toMatchObject({ removed: true, root: scratch.root });
    await expect(access(scratch.root)).rejects.toBeDefined();
    await expect(access(deps.scratchRoot!)).resolves.toBeUndefined();

    await expect(
      executeDeviceRpc('cleanupScratchWorkspace', { topicId: 'topic-cleanup' }, deps),
    ).resolves.toMatchObject({ removed: false, root: scratch.root });
  });

  it('cannot use scratch cleanup as an arbitrary recursive-delete primitive', async () => {
    const deps = makeDeps();
    await expect(executeDeviceRpc('cleanupScratchWorkspace', {}, deps)).rejects.toThrow(
      'topicId is required',
    );
    await expect(
      executeDeviceRpc('cleanupScratchWorkspace', { topicId: '../../' }, deps),
    ).resolves.toMatchObject({ removed: false, topicSegment: expect.stringMatching(/^topic-/) });
    await expect(access(root)).resolves.toBeUndefined();

    await expect(
      executeDeviceRpc(
        'cleanupScratchWorkspace',
        { topicId: 'topic' },
        {
          ...deps,
          scratchRoot: '/',
        },
      ),
    ).rejects.toThrow('SCOPE_DENIED');
  });

  it('rejects a scratch root symlink that resolves to the home directory', async () => {
    const scratchRoot = path.join(root, '.unsafe-scratch-link');
    await symlink(homedir(), scratchRoot, 'dir');
    const deps = { ...makeDeps(), scratchRoot };

    await expect(
      executeDeviceRpc('ensureScratchWorkspace', { topicId: 'topic' }, deps),
    ).rejects.toThrow('SCOPE_DENIED');
    await expect(
      executeDeviceRpc('cleanupScratchWorkspace', { topicId: 'topic' }, deps),
    ).rejects.toThrow('SCOPE_DENIED');
  });

  it('canonicalizes an existing path on the device and rejects relative input', async () => {
    const linked = path.join(root, 'canonical-link');
    await symlink(path.join(root, '.agents'), linked);

    await expect(
      executeDeviceRpc('resolveRealPath', { path: linked }, makeDeps()),
    ).resolves.toEqual({ path: await realpath(path.join(root, '.agents')) });
    await expect(
      executeDeviceRpc('resolveRealPath', { path: 'relative/path' }, makeDeps()),
    ).rejects.toThrow('ABSOLUTE_PATH_REQUIRED');
    await expect(
      executeDeviceRpc('resolveRealPath', { path: path.join(root, 'missing.xlsx') }, makeDeps()),
    ).rejects.toThrow('PATH_NOT_FOUND');
  });

  it('delegates the v2 heterogeneous RPC without dropping execution inputs', async () => {
    const runHeterogeneousAgent = vi.fn(async () => ({ status: 'accepted' as const }));
    const deps = { ...makeDeps(), runHeterogeneousAgent };
    const params = {
      agentType: 'codex',
      cwd: '/approved/project',
      env: { SAFE_NAME: 'value' },
      imageList: [{ url: 'https://example.test/image.png' }],
      jwt: 'secret',
      operationId: 'op-1',
      prompt: 'work',
      resumeSessionId: 'session-1',
      systemContext: 'instructions',
      topicId: 'topic-1',
    };

    await expect(executeDeviceRpc('runHeterogeneousAgent', params, deps)).resolves.toEqual({
      status: 'accepted',
    });
    expect(runHeterogeneousAgent).toHaveBeenCalledWith(params);
  });

  it('routes listProjectSkills to the .agents/skills source', async () => {
    const result = (await executeDeviceRpc('listProjectSkills', { scope: root }, makeDeps())) as {
      source: string | null;
    };
    expect(result.source).toBe('.agents/skills');
  });

  it('routes statPath and reports a directory + repo type', async () => {
    const result = (await executeDeviceRpc('statPath', { path: root }, makeDeps())) as {
      exists: boolean;
      isDirectory: boolean;
    };
    expect(result.exists).toBe(true);
    expect(result.isDirectory).toBe(true);
  });

  it('returns device-realpathed skill paths only when the skill stays in the workspace', async () => {
    const skillDir = path.join(root, '.agents', 'skills', 'spa-routes');
    const result = (await executeDeviceRpc(
      'verifySkillPaths',
      { skillDir, workspaceRoot: root },
      makeDeps(),
    )) as { skillDir: string; workspaceRoot: string };

    expect(result).toEqual({
      skillDir: await realpath(skillDir),
      workspaceRoot: await realpath(root),
    });
  });

  it('verifies only prepared app-owned bundle roots outside the workspace', async () => {
    const cache = await mkdtemp(path.join(tmpdir(), 'device-skill-cache-'));
    const hash = 'a'.repeat(64);
    const bundle = path.join(cache, 'extracted', hash);
    const wrapped = path.join(bundle, 'wrapped');
    const deps = { ...makeDeps(), skillCacheRoot: cache };
    try {
      await mkdir(wrapped, { recursive: true });
      await writeFile(path.join(wrapped, 'SKILL.md'), '# skill');
      const input = { skillDir: wrapped, workspaceRoot: root };
      await expect(executeDeviceRpc('verifySkillPaths', input, deps)).rejects.toThrow();
      await writeFile(path.join(bundle, '.prepared'), hash);
      await expect(executeDeviceRpc('verifySkillPaths', input, deps)).resolves.toEqual({
        skillDir: await realpath(wrapped),
        workspaceRoot: await realpath(root),
      });
      await expect(executeDeviceRpc('verifySkillPaths', input, makeDeps())).rejects.toThrow();
      const escape = path.join(bundle, 'escape');
      await symlink(tmpdir(), escape);
      await expect(
        executeDeviceRpc('verifySkillPaths', { ...input, skillDir: escape }, deps),
      ).rejects.toThrow();
      await writeFile(path.join(bundle, '.prepared'), 'wrong-hash');
      await expect(executeDeviceRpc('verifySkillPaths', input, deps)).rejects.toThrow();
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  it('rejects a skill directory whose symlink resolves outside the workspace', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'device-control-outside-'));
    const link = path.join(root, '.agents', 'skills', 'escaped');
    await symlink(outside, link);

    await expect(
      executeDeviceRpc('verifySkillPaths', { skillDir: link, workspaceRoot: root }, makeDeps()),
    ).rejects.toThrow('SCOPE_DENIED');
    await rm(outside, { force: true, recursive: true });
  });

  it('delegates getProjectFileIndex and getLocalFilePreview to injected deps', async () => {
    const deps = makeDeps();
    await executeDeviceRpc('getProjectFileIndex', { scope: root }, deps);
    expect(deps.getProjectFileIndex).toHaveBeenCalledWith({ scope: root });

    const previewParams = { path: path.join(root, 'AGENTS.md'), workingDirectory: root };
    await executeDeviceRpc('getLocalFilePreview', previewParams, deps);
    expect(deps.getLocalFilePreview).toHaveBeenCalledWith(previewParams);
  });

  it('routes a git method (listGitBranches) without touching deps', async () => {
    // Not a git repo → the shared local-file-shell impl returns an empty list.
    const result = await executeDeviceRpc('listGitBranches', { path: root }, makeDeps());
    expect(Array.isArray(result)).toBe(true);
  });

  it('routes moveLocalFiles to the shared local-file-shell impl', async () => {
    const oldPath = path.join(root, 'move-src.txt');
    const newPath = path.join(root, 'move-dst.txt');
    await writeFile(oldPath, 'hello');

    const result = (await executeDeviceRpc(
      'moveLocalFiles',
      { items: [{ newPath, oldPath }] },
      makeDeps(),
    )) as { newPath?: string; success: boolean }[];

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(true);
    expect(result[0].newPath).toBe(newPath);
  });

  it('routes renameLocalFile to the shared local-file-shell impl', async () => {
    const filePath = path.join(root, 'rename-src.txt');
    await writeFile(filePath, 'hello');

    const result = (await executeDeviceRpc(
      'renameLocalFile',
      { newName: 'rename-dst.txt', path: filePath },
      makeDeps(),
    )) as { newPath: string; success: boolean };

    expect(result.success).toBe(true);
    expect(result.newPath).toBe(path.join(root, 'rename-dst.txt'));
  });

  it('routes writeLocalFile to the shared local-file-shell impl', async () => {
    const filePath = path.join(root, 'write-target.txt');

    const result = (await executeDeviceRpc(
      'writeLocalFile',
      { content: 'remote edit', path: filePath },
      makeDeps(),
    )) as { success: boolean };

    expect(result.success).toBe(true);
    expect(await readFile(filePath, 'utf8')).toBe('remote edit');
  });
});
