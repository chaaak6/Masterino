import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import type { ExecutionContext } from '@lobechat/types/src/executionContext';
import { describe, expect, it } from 'vitest';

import {
  buildPendingWorkspacePathConsent,
  getPostDispatchWorkspacePathConsent,
  tagWorkspacePathInterventionAudits,
  workspacePathInterventionAudits,
} from '../workspacePathConsent';

const executionContext: ExecutionContext = {
  accessRoots: [
    {
      modes: ['read', 'write', 'exec'],
      rootPath: '/workspace',
      scope: 'primary' as const,
      source: 'workspace' as const,
    },
  ],
  cwd: '/workspace',
  operationId: 'op-123',
  plan: { deviceId: 'device-a', kind: 'device' as const, target: 'local' as const },
  version: 1 as const,
  workspace: { deviceId: 'device-a', kind: 'device' as const, rootPath: '/workspace' },
};

describe('runtime workspace path consent', () => {
  it('authors a read intervention from typed local-system args and frozen context', () => {
    expect(
      buildPendingWorkspacePathConsent({
        activeDeviceId: 'device-a',
        executionContext,
        operationId: 'op-123',
        tool: {
          apiName: 'readFile',
          arguments: '{"path":"/outside/docs/readme.md"}',
          id: 'call-a',
          identifier: LocalSystemIdentifier,
          type: 'builtin',
        },
        topicId: 'topic-a',
      }),
    ).toEqual({
      actualCwd: '/workspace',
      deviceId: 'device-a',
      modes: ['read'],
      operationId: 'op-123',
      primaryCwd: '/workspace',
      requestedPath: '/outside/docs/readme.md',
      topicId: 'topic-a',
      version: 1,
    });
  });

  it('does not duplicate consent when a frozen operation root already covers the read', () => {
    expect(
      buildPendingWorkspacePathConsent({
        activeDeviceId: 'device-a',
        executionContext: {
          ...executionContext,
          accessRoots: [
            ...(executionContext.accessRoots ?? []),
            {
              modes: ['read'],
              operationId: 'op-123',
              rootPath: '/outside/docs',
              scope: 'operation',
              source: 'direct-user-message',
            },
          ],
        },
        operationId: 'op-123',
        tool: {
          apiName: 'readFile',
          arguments: '{"path":"/outside/docs/readme.md"}',
          id: 'call-a',
          identifier: LocalSystemIdentifier,
          type: 'builtin',
        },
        topicId: 'topic-a',
      }),
    ).toBeUndefined();
  });

  it('requires explicit approval before reading credentials named in a direct user message', async () => {
    const directCredentialContext: ExecutionContext = {
      ...executionContext,
      accessRoots: [
        ...(executionContext.accessRoots ?? []),
        {
          modes: ['read'],
          operationId: 'op-123',
          rootPath: '/outside/project/.env',
          scope: 'operation',
          source: 'direct-user-message',
        },
      ],
    };
    const tool = {
      apiName: 'readFile',
      arguments: '{"path":"/outside/project/.env"}',
      id: 'call-credential',
      identifier: LocalSystemIdentifier,
      type: 'builtin' as const,
    };

    expect(
      buildPendingWorkspacePathConsent({
        activeDeviceId: 'device-a',
        executionContext: directCredentialContext,
        operationId: 'op-123',
        tool,
        topicId: 'topic-a',
      }),
    ).toMatchObject({ modes: ['read'], requestedPath: '/outside/project/.env' });

    await expect(
      workspacePathInterventionAudits['workspacePathScopeAudit:readFile'](
        { path: '/outside/project/.env' },
        { executionContext: directCredentialContext, workingDirectory: '/workspace' },
      ),
    ).resolves.toBe(true);
  });

  it('requests the existing parent directory for a prospective write target', () => {
    expect(
      buildPendingWorkspacePathConsent({
        activeDeviceId: 'device-a',
        executionContext,
        operationId: 'op-123',
        tool: {
          apiName: 'writeFile',
          arguments: '{"path":"/outside/generated/report.md","content":"report"}',
          id: 'call-write',
          identifier: LocalSystemIdentifier,
          type: 'builtin',
        },
        topicId: 'topic-a',
      }),
    ).toMatchObject({ modes: ['write'], requestedPath: '/outside/generated' });
  });

  it('accepts post-dispatch evidence only when its runtime tuple matches', () => {
    const state = {
      code: 'INTERVENTION_REQUIRED',
      workspacePathConsent: {
        actualCwd: '',
        deviceId: 'device-a',
        modes: ['read'],
        operationId: 'op-123',
        primaryCwd: '',
        requestedPath: '/outside/docs',
        topicId: 'topic-a',
        version: 1,
      },
    };
    expect(
      getPostDispatchWorkspacePathConsent({
        activeDeviceId: 'device-a',
        operationId: 'op-123',
        result: { content: 'INTERVENTION_REQUIRED', state, success: false },
        topicId: 'topic-a',
      }),
    ).toMatchObject({ requestedPath: '/outside/docs' });
    expect(
      getPostDispatchWorkspacePathConsent({
        activeDeviceId: 'device-other',
        operationId: 'op-123',
        result: { content: 'INTERVENTION_REQUIRED', state, success: false },
        topicId: 'topic-a',
      }),
    ).toBeUndefined();
  });

  it('tags local audits and skips redundant prompts for frozen direct-read roots', async () => {
    const frozenContext: ExecutionContext = {
      ...executionContext,
      accessRoots: [
        ...(executionContext.accessRoots ?? []),
        {
          modes: ['read'],
          operationId: 'op-123',
          rootPath: '/outside/docs',
          scope: 'operation',
          source: 'direct-user-message',
        },
      ],
    };
    const tagged = tagWorkspacePathInterventionAudits({
      executorMap: {},
      manifestMap: {
        [LocalSystemIdentifier]: {
          api: [
            {
              humanIntervention: {
                dynamic: { default: 'never', policy: 'required', type: 'pathScopeAudit' },
              },
              name: 'readFile',
            },
          ],
          identifier: LocalSystemIdentifier,
        },
      },
      sourceMap: {},
      tools: [],
    } as any);
    expect(
      (
        tagged.manifestMap[LocalSystemIdentifier]!.api![0]!.humanIntervention as {
          dynamic: { type: string };
        }
      ).dynamic.type,
    ).toBe('workspacePathScopeAudit:readFile');

    await expect(
      workspacePathInterventionAudits['workspacePathScopeAudit:readFile'](
        { path: '/outside/docs/readme.md' },
        { executionContext: frozenContext, workingDirectory: '/workspace' },
      ),
    ).resolves.toBe(false);
    await expect(
      workspacePathInterventionAudits['workspacePathScopeAudit:writeFile'](
        { path: '/outside/docs/readme.md' },
        { executionContext: frozenContext, workingDirectory: '/workspace' },
      ),
    ).resolves.toBe(true);
  });

  it('lets a topic grant cover a later write on the same path', async () => {
    const grantedContext: ExecutionContext = {
      ...executionContext,
      accessRoots: [
        ...(executionContext.accessRoots ?? []),
        {
          deviceId: 'device-a',
          grantId: 'grant-1',
          modes: ['read'],
          rootPath: '/outside/docs',
          scope: 'topic',
          source: 'user-approval',
          topicId: 'topic-a',
        },
      ],
    };

    await expect(
      workspacePathInterventionAudits['workspacePathScopeAudit:writeFile'](
        { path: '/outside/docs/readme.md' },
        { executionContext: grantedContext, workingDirectory: '/workspace' },
      ),
    ).resolves.toBe(false);
  });
});
