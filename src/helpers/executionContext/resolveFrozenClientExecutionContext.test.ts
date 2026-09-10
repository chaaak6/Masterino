import type { ExecutionContext } from '@lobechat/types/src/executionContext';
import { describe, expect, it } from 'vitest';

import {
  mergeCurrentTopicGrantsIntoExecutionContext,
  resolveFrozenClientExecutionContext,
} from './resolveFrozenClientExecutionContext';

const workspace = {
  deviceId: 'device-1',
  id: 'workspace-1',
  kind: 'device' as const,
  rootPath: '/repo',
};

describe('resolveFrozenClientExecutionContext', () => {
  it('replaces captured topic authority without changing the frozen execution identity', () => {
    const frozenContext: ExecutionContext = {
      accessRoots: [
        {
          modes: ['read', 'write', 'exec'],
          rootPath: '/scratch/original',
          scope: 'primary' as const,
          source: 'workspace' as const,
        },
        {
          deviceId: 'device-1',
          grantId: 'captured-topic-grant',
          modes: ['read'],
          rootPath: '/captured-but-revoked',
          scope: 'topic' as const,
          source: 'user-approval' as const,
          topicId: 'topic-1',
        },
        {
          modes: ['read'],
          operationId: 'paused-operation',
          rootPath: '/one-shot',
          scope: 'operation' as const,
          source: 'user-approval' as const,
          topicId: 'topic-1',
        },
      ],
      cwd: '/scratch/original',
      envFiles: ['.env.local'],
      operationId: 'paused-operation',
      plan: { deviceId: 'device-1', kind: 'device' as const, target: 'local' as const },
      version: 1 as const,
      workspace: {
        deviceId: 'device-1',
        id: 'scratch-1',
        kind: 'scratch' as const,
        rootPath: '/scratch/original',
      },
    };

    const context = mergeCurrentTopicGrantsIntoExecutionContext({
      context: frozenContext,
      operationId: 'resumed-operation',
      topicGrants: [
        {
          createdAt: '2026-01-01T00:00:00.000Z',
          deviceId: 'device-1',
          id: 'current-topic-grant',
          modes: ['read'],
          requestedVia: {},
          rootPath: '/private/tmp/work.html',
          scope: 'topic',
          topicId: 'topic-1',
          userId: 'user-1',
        },
      ],
      topicId: 'topic-1',
    });

    expect(context).toEqual({
      ...frozenContext,
      accessRoots: [
        frozenContext.accessRoots![0],
        frozenContext.accessRoots![2],
        {
          deviceId: 'device-1',
          grantId: 'current-topic-grant',
          modes: ['read'],
          rootPath: '/private/tmp/work.html',
          scope: 'topic',
          source: 'user-approval',
          topicId: 'topic-1',
        },
      ],
      operationId: 'resumed-operation',
    });
  });

  it('preserves the complete topic-grant evidence for the device boundary', () => {
    const context = resolveFrozenClientExecutionContext({
      agencyConfig: { executionTargetByPlatform: { desktop: 'local' } },
      initialTopicMetadata: { workspaceId: workspace.id },
      isDesktop: true,
      operationId: 'operation-1',
      requestedDeviceId: 'device-1',
      topicGrants: [
        {
          createdAt: '2026-01-01T00:00:00.000Z',
          deviceId: 'device-1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          id: 'grant-1',
          modes: ['read'],
          requestedVia: {},
          rootPath: '/outside',
          scope: 'topic',
          topicId: 'topic-1',
          userId: 'user-1',
        },
      ],
      topicId: 'topic-1',
      workspaces: { [workspace.id]: workspace },
    });

    expect(context.accessRoots).toEqual([
      {
        modes: ['read', 'write', 'exec'],
        rootPath: '/repo',
        scope: 'primary',
        source: 'workspace',
      },
      {
        deviceId: 'device-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        grantId: 'grant-1',
        modes: ['read'],
        rootPath: '/outside',
        scope: 'topic',
        source: 'user-approval',
        topicId: 'topic-1',
      },
    ]);
  });

  it('drops revoked, expired, cross-topic and cross-device grants', () => {
    const baseGrant = {
      createdAt: '2026-01-01T00:00:00.000Z',
      deviceId: 'device-1',
      id: 'grant',
      modes: ['read'] as Array<'read' | 'write' | 'exec'>,
      requestedVia: {},
      rootPath: '/outside',
      scope: 'topic' as const,
      topicId: 'topic-1',
      userId: 'user-1',
    };
    const context = resolveFrozenClientExecutionContext({
      agencyConfig: { executionTargetByPlatform: { desktop: 'local' } },
      initialTopicMetadata: { workspaceId: workspace.id },
      isDesktop: true,
      requestedDeviceId: 'device-1',
      topicGrants: [
        { ...baseGrant, expiresAt: '2000-01-01T00:00:00.000Z', id: 'expired' },
        { ...baseGrant, id: 'revoked', revokedAt: '2026-01-02T00:00:00.000Z' },
        { ...baseGrant, id: 'other-topic', topicId: 'topic-2' },
        { ...baseGrant, deviceId: 'device-2', id: 'other-device' },
      ],
      topicId: 'topic-1',
      workspaces: { [workspace.id]: workspace },
    });

    expect(context.accessRoots).toHaveLength(1);
    expect(context.accessRoots?.[0]).toMatchObject({ rootPath: '/repo', scope: 'primary' });
  });
});
