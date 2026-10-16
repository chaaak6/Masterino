import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { AsyncTaskStatus } from '@/types/asyncTask';

import { hasExhaustedMemoryJobAttempts, markJobFailed } from './worker';

const { db, update } = vi.hoisted(() => ({ db: {}, update: vi.fn() }));

vi.mock('@/database/server', () => ({ getServerDB: vi.fn(async () => db) }));
vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(function () {
    return { update };
  }),
}));

describe('memory queue worker retry status', () => {
  it('does not mark a retryable failure as final', () => {
    expect(
      hasExhaustedMemoryJobAttempts({
        attemptsMade: 1,
        opts: { attempts: 3 },
      }),
    ).toBe(false);
  });

  it('marks a failure after all configured attempts are exhausted', () => {
    expect(
      hasExhaustedMemoryJobAttempts({
        attemptsMade: 3,
        opts: { attempts: 3 },
      }),
    ).toBe(true);
  });

  it('treats a missing job as a final worker failure', () => {
    expect(hasExhaustedMemoryJobAttempts(undefined)).toBe(true);
  });
});

describe('memory queue final failure ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([undefined, 'workspace-1'])(
    'marks the task failed in its original scope: %s',
    async (workspaceId) => {
      const job = { data: { asyncTaskId: 'task-1', userId: 'user-1', workspaceId } };
      await markJobFailed(
        job as Parameters<typeof markJobFailed>[0],
        new Error('Retries exhausted'),
      );
      expect(AsyncTaskModel).toHaveBeenCalledWith(db, 'user-1', workspaceId);
      expect(update).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: AsyncTaskStatus.Error }),
      );
    },
  );
});
