import type { ExecutionContext } from '@lobechat/types/src/executionContext';
import { describe, expect, it } from 'vitest';

import { arePathsCoveredByExecutionContext } from './authorizedPathAudit';

const context: ExecutionContext = {
  accessRoots: [
    {
      deviceId: 'device-1',
      grantId: 'grant-1',
      modes: ['read'],
      rootPath: '/private/tmp/shared/note.txt',
      scope: 'topic',
      source: 'user-approval',
      topicId: 'topic-1',
    },
  ],
  cwd: '/workspace/project',
  operationId: 'operation-1',
  plan: { deviceId: 'device-1', kind: 'device', target: 'local' },
  version: 1,
  workspace: {
    deviceId: 'device-1',
    kind: 'device',
    rootPath: '/workspace/project',
  },
};

describe('arePathsCoveredByExecutionContext', () => {
  it('accepts an already granted read outside the primary workspace', () => {
    expect(
      arePathsCoveredByExecutionContext({
        apiName: 'readFile',
        context,
        paths: ['/private/tmp/shared/note.txt'],
        resolveAgainstScope: '/workspace/project',
      }),
    ).toBe(true);
  });

  it('does not turn a read-only grant into write authority', () => {
    expect(
      arePathsCoveredByExecutionContext({
        apiName: 'writeFile',
        context,
        paths: ['/private/tmp/shared/note.txt'],
        resolveAgainstScope: '/workspace/project',
      }),
    ).toBe(false);
  });

  it.each([
    ['another device', { ...context.accessRoots![0], deviceId: 'device-2' }],
    [
      'an expired grant',
      { ...context.accessRoots![0], expiresAt: '2020-01-01T00:00:00.000Z' },
    ],
  ])('rejects %s', (_label, root) => {
    expect(
      arePathsCoveredByExecutionContext({
        apiName: 'readFile',
        context: { ...context, accessRoots: [root] },
        paths: ['/private/tmp/shared/note.txt'],
        resolveAgainstScope: '/workspace/project',
      }),
    ).toBe(false);
  });

  it('requires every requested path to be covered', () => {
    expect(
      arePathsCoveredByExecutionContext({
        apiName: 'readFiles',
        context,
        paths: ['/private/tmp/shared/note.txt', '/private/tmp/other.txt'],
        resolveAgainstScope: '/workspace/project',
      }),
    ).toBe(false);
  });
});
