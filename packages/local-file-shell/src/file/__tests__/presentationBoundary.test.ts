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
  });
});
