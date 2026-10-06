import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DeviceToolCallExecutionContext } from '../../types';
import { prepareToolCallExecution } from '../executionBoundary';

describe('presentation execution boundary', () => {
  let root: string;
  let workspace: string;
  let context: DeviceToolCallExecutionContext;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'presentation-boundary-'));
    workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    workspace = await realpath(workspace);
    context = {
      accessRoots: [
        {
          modes: ['read', 'write'],
          rootPath: workspace,
          scope: 'primary',
          source: 'workspace',
        },
      ],
      cwd: workspace,
      workspaceRootPath: workspace,
    };
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('resolves bundled script paths and denies scripts outside the workspace', async () => {
    context.accessRoots![0]!.modes.push('exec');
    const script = path.join(workspace, 'task.py');
    await writeFile(script, 'print("ok")');
    const prepared = await prepareToolCallExecution({
      apiName: 'runCommand',
      args: {
        runtime: 'bundled-python',
        command: 'task.py',
        args: ['中文'],
      },
      context,
      homeDir: root,
    });
    expect(prepared.args.command).toBe(script);
    expect(prepared.args.args).toEqual(['中文']);
    expect(
      prepared.scopeAudit.some((entry) => entry.mode === 'read' && entry.path === script),
    ).toBe(true);
    await expect(
      prepareToolCallExecution({
        apiName: 'runCommand',
        args: {
          runtime: 'bundled-python',
          command: path.join(root, 'outside.py'),
        },
        context,
        homeDir: root,
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
  });

  it('audits the old transaction output even when a retry changes its output', async () => {
    const projectPath = path.join(workspace, 'deck.pptx.masterino.json');
    await writeFile(projectPath, JSON.stringify({ deck: { slides: [] } }));
    await writeFile(
      `${projectPath}.lock`,
      JSON.stringify({
        transaction: {
          id: '11111111-1111-4111-8111-111111111111',
          projectPath,
          outputPath: path.join(root, 'outside.pptx'),
        },
      }),
    );
    await expect(
      prepareToolCallExecution({
        apiName: 'revisePresentation',
        args: {
          projectPath,
          outputPath: 'new.pptx',
          operations: [],
          expectedRevision: 1,
        },
        context,
        homeDir: root,
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
  });

  it('audits PPTX output, project and local image paths before Electron executes', async () => {
    await writeFile(path.join(workspace, 'logo.png'), 'image');
    const prepared = await prepareToolCallExecution({
      apiName: 'createPresentation',
      args: {
        path: 'deck.pptx',
        deck: {
          slides: [
            {
              elements: [
                {
                  type: 'image',
                  source: { path: 'logo.png' },
                },
              ],
            },
          ],
        },
      },
      context,
      homeDir: root,
    });

    expect(prepared.args.path).toBe(path.join(workspace, 'deck.pptx'));
    expect(prepared.args.deck.slides[0].elements[0].source.path).toBe(
      path.join(workspace, 'logo.png'),
    );
    expect(prepared.scopeAudit.map((entry) => entry.mode)).toEqual(['write', 'write', 'read']);
    expect(prepared.scopeAudit.map((entry) => entry.path)).toContain(
      path.join(workspace, 'deck.pptx.masterino.json'),
    );
  });

  it('rejects a presentation image outside the authorized workspace', async () => {
    const outside = path.join(root, 'outside.png');
    await writeFile(outside, 'image');

    await expect(
      prepareToolCallExecution({
        apiName: 'createPresentation',
        args: {
          path: 'deck.pptx',
          deck: { slides: [{ elements: [{ type: 'image', source: { path: outside } }] }] },
        },
        context,
        homeDir: root,
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
  });

  it('rejects an existing project whose stored image escaped the workspace', async () => {
    const outside = path.join(root, 'outside.png');
    await writeFile(outside, 'image');
    const projectPath = path.join(workspace, 'deck.pptx.masterino.json');
    await writeFile(
      projectPath,
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        id: 'p',
        deck: { slides: [{ elements: [{ type: 'image', source: { path: outside } }] }] },
      }),
    );

    await expect(
      prepareToolCallExecution({
        apiName: 'revisePresentation',
        args: {
          projectPath,
          outputPath: path.join(workspace, 'revised.pptx'),
          expectedRevision: 1,
          operations: [],
        },
        context,
        homeDir: root,
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });

    await expect(
      prepareToolCallExecution({
        apiName: 'renderPresentationPreview',
        args: { projectPath },
        context,
        homeDir: root,
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
  });

  it('rejects an image path introduced by an updateElement patch', async () => {
    const outside = path.join(root, 'outside.png');
    await writeFile(outside, 'image');
    const projectPath = path.join(workspace, 'deck.pptx.masterino.json');
    await writeFile(
      projectPath,
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        id: 'p',
        deck: {
          slides: [
            {
              id: 'cover',
              elements: [
                {
                  id: 'hero',
                  type: 'image',
                  frame: { h: 1, w: 1, x: 0, y: 0 },
                  source: { path: path.join(workspace, 'original.png') },
                },
              ],
            },
          ],
        },
      }),
    );
    await writeFile(path.join(workspace, 'original.png'), 'image');

    await expect(
      prepareToolCallExecution({
        apiName: 'revisePresentation',
        args: {
          projectPath,
          outputPath: path.join(workspace, 'revised.pptx'),
          expectedRevision: 1,
          operations: [
            {
              op: 'updateElement',
              slideId: 'cover',
              elementId: 'hero',
              patch: { source: { path: outside } },
            },
          ],
        },
        context,
        homeDir: root,
      }),
    ).rejects.toMatchObject({ code: 'INTERVENTION_REQUIRED' });
  });
});
