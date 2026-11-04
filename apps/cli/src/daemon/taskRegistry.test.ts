import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = path.join(os.tmpdir(), `masterino-task-registry-${process.pid}`);

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    default: { ...actual.default, homedir: () => tmpDir },
  };
});

// eslint-disable-next-line import-x/first
import { getTask, saveTask } from './taskRegistry';

describe('task registry managed state', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { force: true, recursive: true }));

  it('writes new task state under ~/.masterino/state', () => {
    const task = {
      agentType: 'openclaw' as const,
      operationId: 'operation-1',
      pid: 123,
      startedAt: new Date(0).toISOString(),
      taskId: 'task-1',
      topicId: 'topic-1',
    };

    saveTask(task);

    expect(getTask(task.taskId)).toEqual(task);
    expect(fs.existsSync(path.join(tmpDir, '.masterino', 'state', 'task-registry.json'))).toBe(
      true,
    );
  });

  it('reads the legacy registry when canonical state does not exist', () => {
    const legacyDir = path.join(tmpDir, '.lobehub');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'task-registry.json'),
      JSON.stringify({
        legacy: {
          agentType: 'hermes',
          operationId: 'operation-old',
          pid: 456,
          startedAt: new Date(0).toISOString(),
          taskId: 'legacy',
          topicId: 'topic-old',
        },
      }),
    );

    expect(getTask('legacy')).toMatchObject({ topicId: 'topic-old' });
  });
});
