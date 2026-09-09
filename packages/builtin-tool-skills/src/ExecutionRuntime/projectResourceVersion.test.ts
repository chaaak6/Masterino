// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { prepareProjectSkillSnapshot } from '../../../device-control/src/projectSkillSnapshot';
import { selectActivatedSkillsFromMessages } from '../activationHistory';
import { SkillsExecutionRuntime } from './index';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

it.each([
  { operation: 'op1', changed: true, missingVersion: false, allowed: true },
  { operation: 'op2', changed: true, missingVersion: false, allowed: false },
  { operation: 'op2', changed: false, missingVersion: false, allowed: true },
  { operation: 'op2', changed: false, missingVersion: true, allowed: false },
])(
  'checks the frozen project resource version: %j',
  async ({ operation, changed, missingVersion, allowed }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skill-runtime-version-'));
    folders.push(root);
    const workspace = path.join(root, 'workspace');
    const source = path.join(workspace, '.agents', 'skills', 'report');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'SKILL.md'), 'Report instructions');
    await writeFile(path.join(source, 'run.py'), 'old script');
    const skill = {
      key: 'project:workspace-a:report',
      identifier: 'report',
      name: 'report',
      description: 'Reporting',
      source: 'project' as const,
      scope: 'project' as const,
      location: path.join(source, 'SKILL.md'),
    };
    const runner = vi.fn().mockResolvedValue({ exitCode: 0, output: 'ok', success: true });
    const createRuntime = (operationId: string) =>
      new SkillsExecutionRuntime({
        service: {
          findAll: async () => ({ data: [], total: 0 }),
          findById: async () => undefined,
          findByName: async () => undefined,
          readResource: vi.fn(),
        },
        registryResult: { skills: [skill] },
        deviceFileAccess: {
          readFile: async (file) => readFile(file, 'utf8'),
          listFiles: async () => [],
        },
        executionContext: {
          version: 1,
          operationId,
          cwd: workspace,
          plan: { kind: 'device', target: 'device', deviceId: 'device-1' },
          workspace: { kind: 'device', deviceId: 'device-1', rootPath: workspace },
        },
        deviceScriptRunner: runner,
        deviceSkillPathVerifier: async ({ skillDir, workspaceRoot }) => ({
          skillDir,
          workspaceRoot,
        }),
        projectSnapshotResolver: ({ key, location, resourcePath }) =>
          prepareProjectSkillSnapshot(
            { operationId, skillId: key, path: location, resourcePath, workspaceRoot: workspace },
            path.join(root, 'cache'),
          ),
      });
    const activation = await createRuntime('op1').activateSkill({ name: skill.key });
    expect(activation.success).toBe(true);
    expect(activation.state?.id).toBe(skill.key);
    expect(activation.state?.resourceVersion).toMatch(/^[a-f0-9]{64}$/);
    const history = selectActivatedSkillsFromMessages([
      {
        role: 'tool',
        plugin: { identifier: 'lobe-skills', apiName: 'activateSkill' },
        pluginState: activation.state,
      },
    ])!;
    if (missingVersion) delete history[0].resourceVersion;
    if (changed) await writeFile(path.join(source, 'run.py'), 'new script');
    const nextRuntime = createRuntime(operation);
    const execute = () =>
      nextRuntime.execScript({
        command: 'python "$SKILL_DIR/run.py"',
        description: 'Run report',
        skillId: skill.key,
        activatedSkills: history,
      });
    const result = await execute();
    expect(result.success).toBe(allowed);
    if (allowed) {
      expect(runner).toHaveBeenCalledOnce();
      const options = runner.mock.calls[0][1];
      expect(await readFile(path.join(options.env.SKILL_DIR, 'run.py'), 'utf8')).toBe('old script');
    } else {
      expect(result.state?.errorCode).toBe('SKILL_RESOURCE_VERSION_CHANGED');
      expect(runner).not.toHaveBeenCalled();
      const renewed = await nextRuntime.activateSkill({ name: skill.key });
      history[0].resourceVersion = renewed.state?.resourceVersion;
      expect((await execute()).success).toBe(true);
      expect(runner).toHaveBeenCalledOnce();
    }
  },
);
