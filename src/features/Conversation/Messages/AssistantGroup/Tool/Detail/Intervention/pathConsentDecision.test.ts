import { describe, expect, it, vi } from 'vitest';

import type { PathConsentSelection } from './PathConsent';
import { coordinatePathConsentApproval, PathConsentResolutionError } from './pathConsentDecision';

const decision = (scope: 'operation' | 'topic'): PathConsentSelection => ({
  actualCwd: '/workspace/project',
  deviceId: 'device-1',
  modes: ['read'],
  operationId: 'operation-1',
  primaryCwd: '/workspace/project',
  requestedPath: '/missing/report.xlsx',
  rootPath: '/missing/report.xlsx',
  scope,
  topicId: 'topic-1',
});

describe('coordinatePathConsentApproval', () => {
  it('canonicalizes, grants, persists, then resumes one topic approval in order', async () => {
    const resolveRootPath = vi.fn().mockResolvedValue('/private/tmp/report.xlsx');
    const grantTopicRoot = vi.fn().mockResolvedValue(undefined);
    const persistDecision = vi.fn();
    const resume = vi.fn().mockResolvedValue(undefined);

    const result = await coordinatePathConsentApproval(decision('topic'), {
      grantTopicRoot,
      persistDecision,
      resolveRootPath,
      resume,
    });

    expect(result.rootPath).toBe('/private/tmp/report.xlsx');
    expect(grantTopicRoot).toHaveBeenCalledWith('/private/tmp/report.xlsx');
    expect(persistDecision).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: '/private/tmp/report.xlsx', scope: 'topic' }),
    );
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resolveRootPath.mock.invocationCallOrder[0]).toBeLessThan(
      grantTopicRoot.mock.invocationCallOrder[0],
    );
    expect(grantTopicRoot.mock.invocationCallOrder[0]).toBeLessThan(
      persistDecision.mock.invocationCallOrder[0],
    );
    expect(persistDecision.mock.invocationCallOrder[0]).toBeLessThan(
      resume.mock.invocationCallOrder[0],
    );
  });

  it('does not create a persisted topic grant for a one-operation approval', async () => {
    const grantTopicRoot = vi.fn();
    const persistDecision = vi.fn();
    const resume = vi.fn().mockResolvedValue(undefined);

    await coordinatePathConsentApproval(decision('operation'), {
      grantTopicRoot,
      persistDecision,
      resolveRootPath: vi.fn().mockResolvedValue('/private/tmp/report.xlsx'),
      resume,
    });

    expect(grantTopicRoot).not.toHaveBeenCalled();
    expect(persistDecision).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it.each(['operation', 'topic'] as const)(
    'leaves authorization and execution state untouched when a %s path does not exist',
    async (scope) => {
      const executionContext = Object.freeze({
        accessRoots: [{ modes: ['read'], path: '/workspace/project' }],
        cwd: '/workspace/project',
        workingModel: { model: 'glm-5.2', provider: 'newapi' },
        workspace: { kind: 'device', root: '/workspace/project' },
      });
      const before = structuredClone(executionContext);
      const grantTopicRoot = vi.fn();
      const persistDecision = vi.fn();
      const resume = vi.fn();

      await expect(
        coordinatePathConsentApproval(decision(scope), {
          grantTopicRoot,
          persistDecision,
          resolveRootPath: vi
            .fn()
            .mockRejectedValue(new PathConsentResolutionError('PATH_NOT_FOUND')),
          resume,
        }),
      ).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });

      expect(grantTopicRoot).not.toHaveBeenCalled();
      expect(persistDecision).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
      expect(executionContext).toEqual(before);
    },
  );
});
