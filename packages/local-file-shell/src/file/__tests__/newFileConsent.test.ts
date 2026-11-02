import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prepareToolCallExecution, resolveNewFileConsentDirectory } from '../executionBoundary';

describe('new file directory consent', () => {
  let root: string;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'new-file-consent-')));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('offers the existing parent for a new Word, then permits the approved retry', async () => {
    const cwd = path.join(root, 'workspace');
    const output = path.join(root, 'output');
    await mkdir(cwd);
    await mkdir(output);
    const target = path.join(output, 'report.docx');
    const context = { cwd, workspaceRootPath: cwd, approvalMode: 'manual' as const };
    await expect(
      prepareToolCallExecution({
        apiName: 'createOfficeDocument',
        args: { path: target },
        context,
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
    const consentRoot = await resolveNewFileConsentDirectory('createOfficeDocument', target);
    expect(consentRoot).toBe(output);
    const prepared = await prepareToolCallExecution({
      apiName: 'createOfficeDocument',
      args: { path: target },
      context: {
        ...context,
        accessRoots: [
          {
            rootPath: consentRoot!,
            modes: ['write'],
            scope: 'operation',
            source: 'user-approval',
            operationId: 'retry',
          },
        ],
      },
      trace: { operationId: 'retry' },
    });
    expect(prepared.args.path).toBe(target);
    await expect(
      prepareToolCallExecution({
        apiName: 'createOfficeDocument',
        args: { path: target },
        context: {
          ...context,
          accessRoots: [
            {
              rootPath: consentRoot!,
              modes: ['write'],
              scope: 'operation',
              source: 'user-approval',
              operationId: 'old',
            },
          ],
        },
        trace: { operationId: 'other' },
      }),
    ).rejects.toBeDefined();
  });
  it('keeps auto approval and directory boundaries unchanged', async () => {
    const workspace = path.join(root, 'A');
    const output = path.join(root, 'B');
    const other = path.join(root, 'C');
    for (const dir of [workspace, output, other]) await mkdir(dir);
    const base = { cwd: workspace, workspaceRootPath: workspace };
    const target = path.join(output, 'auto.txt');
    await expect(
      prepareToolCallExecution({
        apiName: 'writeFile',
        args: { path: target },
        context: { ...base, approvalMode: 'auto-run' },
      }),
    ).resolves.toMatchObject({ args: { path: target } });
    const granted = {
      ...base,
      accessRoots: [
        {
          modes: ['write'] as 'write'[],
          scope: 'operation' as const,
          source: 'user-approval' as const,
          rootPath: output,
          operationId: 'retry',
        },
      ],
    };
    await expect(
      prepareToolCallExecution({
        apiName: 'writeFile',
        args: { path: path.join(other, 'not-granted.txt') },
        context: granted,
        trace: { operationId: 'retry' },
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
  });

  it('does not climb past a missing parent or change existing/read targets', async () => {
    expect(
      await resolveNewFileConsentDirectory('writeFile', path.join(root, 'missing', 'new.txt')),
    ).toBeUndefined();
    expect(
      await resolveNewFileConsentDirectory('readFile', path.join(root, 'new.txt')),
    ).toBeUndefined();
    const existing = path.join(root, 'existing.txt');
    await writeFile(existing, 'test');
    expect(await resolveNewFileConsentDirectory('writeFile', existing)).toBeUndefined();
  });
  it('does not offer HOME or filesystem root as a new grant', async () => {
    expect(
      await resolveNewFileConsentDirectory(
        'writeFile',
        path.join(os.homedir(), 'synthetic-new-file-consent-missing.txt'),
      ),
    ).toBeUndefined();
    expect(
      await resolveNewFileConsentDirectory(
        'writeFile',
        path.join(path.parse(root).root, 'synthetic-new-file-consent-missing.txt'),
      ),
    ).toBeUndefined();
  });

  it('canonicalizes the parent and does not treat a dangling file link as a new file', async () => {
    const output = path.join(root, 'output');
    const alias = path.join(root, 'alias');
    await mkdir(output);
    await symlink(output, alias);
    expect(
      await resolveNewFileConsentDirectory('writeLocalFile', path.join(alias, 'new.txt')),
    ).toBe(output);
    const dangling = path.join(output, 'dangling');
    await symlink(path.join(root, 'missing-file'), dangling);
    expect(await resolveNewFileConsentDirectory('writeFile', dangling)).toBeUndefined();
  });

  it('does not offer sensitive directories or derive directory consent for commands', async () => {
    const sensitive = path.join(root, '.ssh');
    await mkdir(sensitive);
    expect(
      await resolveNewFileConsentDirectory('writeFile', path.join(sensitive, 'new-key')),
    ).toBeUndefined();
    expect(
      await resolveNewFileConsentDirectory('runCommand', path.join(root, 'new.txt')),
    ).toBeUndefined();
  });
});
