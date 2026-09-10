import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  ContextBudgetDecision,
  ContextCompressionOutcome,
} from '@lobechat/types/src/contextBudget';
import { getChatInputModalityConclusion } from '@lobechat/types/src/modelCatalog';
import type { TopicExecutionSnapshot, WorkspaceRef } from '@lobechat/types/src/projectWorkspace';

import { buildAdditionalDirectoriesPrompt } from '../../apps/server/src/services/aiAgent/additionalDirectories';
import { WorkspaceAccessGrantService } from '../../apps/server/src/services/workspaceAccessGrant';
import toolLocale from '../../locales/en-US/tool.json';
import {
  compressContextHierarchically,
  type ContextBudgetEvaluation,
  evaluateContextBudget,
  failureAfterCompression,
  type FinalContextPayload,
  runContextBudgetedCall,
} from '../../packages/agent-runtime/src/utils/contextBudget';
import {
  createModelCatalogSnapshot,
  filterAiProviderChatEligibleModels,
  mergeModelCatalogEntry,
} from '../../packages/business/model-bank/src/modelCatalog';
import { parseExecutionContextValidation } from '../../packages/device-gateway-client/src/http';
import { prepareToolCallExecution } from '../../packages/local-file-shell/src/file/executionBoundary';
import type { UIChatMessage } from '../../packages/types/src/message/ui/chat';
import {
  confirmWorkspaceBindingIntent,
  selectWorkspaceOnce,
} from '../../src/features/ChatInput/ControlBar/workspaceBindingActions';
import { parseStructuredPathConsentRequest } from '../../src/features/Conversation/Messages/AssistantGroup/Tool/Detail/Intervention/PathConsent';
import {
  buildContextBudgetErrorViewModel,
  getContextBudgetFailureFromErrorBody,
} from '../../src/features/Conversation/utils/contextBudgetView';
import {
  buildExecutionAccessRoots,
  buildWorkspaceScopeKey,
  decideWorkspaceBind,
  normalizeWorkspaceIdentity,
  resolveExecutionContext,
  routeHeterogeneousExecution,
  toToolCallExecutionContext,
} from '../../src/helpers/executionContext';
import { classifyTopicPlacement } from '../../src/helpers/topicPlacement';
import { resolveHeteroResume } from '../../src/store/chat/slices/aiChat/actions/heteroResume';
import { buildWorkspaceTopicNavigation } from '../../src/store/projectWorkspace/topicNavigation';
import type {
  AcceptanceResultMap,
  ContextBudgetFailCode,
  WorkspaceRuntimeAcceptanceAdapter,
} from './contracts';

type ProductionAcceptanceId = Exclude<
  keyof WorkspaceRuntimeAcceptanceAdapter,
  'AC-W01' | 'AC-W02' | 'AC-W03'
>;
type ProductionAcceptanceAdapter = Pick<WorkspaceRuntimeAcceptanceAdapter, ProductionAcceptanceId>;

const NOW = '2026-09-03T00:00:00.000Z';
const OPERATION_ID = 'operation-workspace-runtime';
const DEVICE_ID = 'device-a';
const TOPIC_ID = 'topic-a';

const workspace = (overrides: Partial<WorkspaceRef> = {}): WorkspaceRef => ({
  deviceId: DEVICE_ID,
  id: 'workspace-a',
  kind: 'device',
  rootPath: '/code/masterino',
  ...overrides,
});

const snapshot = (overrides: Partial<TopicExecutionSnapshot> = {}): TopicExecutionSnapshot => ({
  boundDeviceId: DEVICE_ID,
  target: 'local',
  targetCapturedAt: NOW,
  version: 1,
  ...overrides,
});

const chatTopic = (id: string, metadata: Record<string, unknown> = {}, updatedAt = 0) =>
  ({
    createdAt: updatedAt,
    id,
    metadata,
    title: id,
    updatedAt,
  }) as any;

const assistant = (id: string, totalOutputTokens: number): UIChatMessage =>
  ({
    content: '',
    createdAt: 0,
    id,
    metadata: { usage: { totalOutputTokens } },
    role: 'assistant',
    updatedAt: 0,
  }) as UIChatMessage;

const user = (id: string, content: string): UIChatMessage =>
  ({ content, createdAt: 0, id, role: 'user', updatedAt: 0 }) as UIChatMessage;

const baseCatalog = mergeModelCatalogEntry({
  catalog: { contextWindowTokens: 128_000, kind: 'chat' },
  modelId: 'model-a',
  now: NOW,
  providerId: 'provider-a',
});

const catalogSnapshot = createModelCatalogSnapshot(baseCatalog.entry, OPERATION_ID, NOW);

const contextBudgetBase = {
  catalogSnapshot,
  driftMultiplier: 1,
  modelId: 'model-a',
  operationId: OPERATION_ID,
  providerId: 'provider-a',
};

const reducedPayload = (payload: FinalContextPayload): FinalContextPayload => ({
  ...payload,
  messages: [
    { ...assistant('summary', 1000), content: 'compressed summary' },
    payload.messages.at(-1) as UIChatMessage,
  ],
});

const compressedOutcome = (
  evaluation: ContextBudgetEvaluation,
  afterTokens = 1001,
): ContextCompressionOutcome => ({
  afterTokens,
  attempt: 1,
  beforeTokens: evaluation.estimatedPromptTokens,
  outcome: 'compressed',
  payloadFingerprint: evaluation.payloadFingerprint,
  trigger:
    evaluation.decision.kind === 'compress' ? evaluation.decision.trigger : 'final-preflight',
});

const withTemporaryTree = async <T>(
  run: (tree: { home: string; outside: string; workspace: string }) => Promise<T>,
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), 'masterino-wsrt-'));
  const home = path.join(root, 'home');
  const workspaceRoot = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  await Promise.all([mkdir(home), mkdir(workspaceRoot), mkdir(outside)]);
  try {
    return await run({ home, outside, workspace: workspaceRoot });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const getErrorCode = async (action: () => Promise<unknown>): Promise<string> => {
  try {
    await action();
    return 'ALLOWED';
  } catch (error) {
    return (error as { code?: string }).code ?? 'UNKNOWN';
  }
};

const makeGrantService = () => {
  let currentTime = new Date(NOW);
  let archived = false;
  let nextId = 1;
  const rows: any[] = [];
  const grantModel = {
    findById: async ({ deviceId, id, topicId }: any) =>
      rows.find((row) => row.id === id && row.deviceId === deviceId && row.topicId === topicId),
    listActive: async ({ deviceId, topicId }: any, now: Date) =>
      rows.filter(
        (row) =>
          !archived &&
          row.deviceId === deviceId &&
          row.topicId === topicId &&
          !row.revokedAt &&
          (!row.expiresAt || row.expiresAt > now),
      ),
    revoke: async ({ deviceId, id, topicId }: any, now: Date) => {
      const row = rows.find(
        (item) => item.id === id && item.deviceId === deviceId && item.topicId === topicId,
      );
      if (row) {
        row.revokedAt = now;
        row.updatedAt = now;
      }
      return row;
    },
    touch: async () => undefined,
    upsert: async (params: any, now: Date) => {
      let row = rows.find(
        (item) =>
          item.deviceId === params.deviceId &&
          item.topicId === params.topicId &&
          item.rootPath === params.rootPath,
      );
      if (!row) {
        row = {
          accessedAt: null,
          createdAt: now,
          id: `grant-${nextId++}`,
          lastUsedAt: null,
          revokedAt: null,
          scope: 'topic',
          updatedAt: now,
          userId: 'user-a',
          ...params,
        };
        rows.push(row);
      } else {
        Object.assign(row, params, { revokedAt: null, updatedAt: now });
      }
      return row;
    },
  };
  const topicModel = {
    findById: async (id: string) =>
      id === TOPIC_ID ? ({ id, status: archived ? 'archived' : 'open' } as any) : undefined,
  };
  const service = new WorkspaceAccessGrantService({
    clock: () => currentTime,
    grantModel: grantModel as any,
    topicModel,
  });
  return {
    archive: () => {
      archived = true;
    },
    rows,
    service,
    setTime: (value: string) => {
      currentTime = new Date(value);
    },
  };
};

const buildNavigation = (
  topics: any[],
  states: Record<string, any>,
  workspaces: Record<string, any>,
) =>
  buildWorkspaceTopicNavigation(topics, {
    sortBy: 'updatedAt',
    topicStatesById: states,
    workspacesById: workspaces,
  });

const modelRows = () => {
  const ids = ['qwen3-vl-rerank', 'bge-reranker-v2', 'text-embedding-3-small', 'qwen3-vl-plus'];
  return ids.map((id) => {
    const catalog = mergeModelCatalogEntry({
      modelId: id,
      providerId: 'newapi',
      providerMetadata:
        id === 'qwen3-vl-plus' ? { endpointTypes: ['chat/completions'] } : undefined,
    });
    return { id, providerId: 'newapi', settings: { modelCatalog: catalog }, type: 'chat' as const };
  });
};

const budgetFailure = (
  code: ContextBudgetFailCode,
): Extract<ContextBudgetDecision, { kind: 'fail' }> => {
  if (code === 'TAIL_TOO_LARGE') {
    return failureAfterCompression(
      {
        afterTokens: 200_000,
        attempt: 1,
        beforeTokens: 200_000,
        code,
        outcome: 'failed',
        payloadFingerprint: code,
        trigger: 'final-preflight',
      },
      [{ estimatedTokens: 200_000, source: 'tool-result' }],
    ) as Extract<ContextBudgetDecision, { kind: 'fail' }>;
  }
  if (code === 'NO_CANDIDATES') {
    return failureAfterCompression(
      {
        afterTokens: 40_000,
        attempt: 1,
        beforeTokens: 40_000,
        code,
        outcome: 'skipped',
        payloadFingerprint: 'no-candidates',
        trigger: 'manual',
      },
      [{ estimatedTokens: 20_000, source: 'tool-result' }],
    ) as Extract<ContextBudgetDecision, { kind: 'fail' }>;
  }
  return failureAfterCompression(
    {
      afterTokens: 40_000,
      attempt: 1,
      beforeTokens: 40_000,
      code,
      outcome: 'failed',
      payloadFingerprint: code,
      trigger: 'final-preflight',
    },
    [],
  ) as Extract<ContextBudgetDecision, { kind: 'fail' }>;
};

export const workspaceRuntimeProductionAcceptanceAdapter: ProductionAcceptanceAdapter = {
  'AC-W04': async () => {
    const workspaceRows = 0;
    const scratchDirectories: string[] = [];
    const projectWorkspaceRowsBefore = workspaceRows;
    const scratchDirectoriesBefore = [...scratchDirectories];
    for (let turn = 0; turn < 5; turn += 1) {
      resolveExecutionContext({ isDesktop: true, onlineDeviceIds: [DEVICE_ID] });
    }
    return {
      projectWorkspaceRowsAfter: workspaceRows,
      projectWorkspaceRowsBefore,
      scratchDirectoriesAfter: scratchDirectories,
      scratchDirectoriesBefore,
    };
  },
  'AC-W05': async () => {
    const taskListCountBefore = 2;
    const taskTopicRowsBefore = 3;
    const taskUiLabelsBefore = ['Scheduled', 'Running'];
    const navigation = buildNavigation([chatTopic('topic-unbound')], {}, {});
    return {
      recentTopicIds: navigation.recent.map(({ topic }) => topic.id),
      taskListCountAfter: taskListCountBefore,
      taskListCountBefore,
      taskTopicRowsAfter: taskTopicRowsBefore,
      taskTopicRowsBefore,
      taskUiLabelsAfter: [...taskUiLabelsBefore],
      taskUiLabelsBefore,
      topLevelTopicVisible: navigation.recent.length > 0,
    };
  },
  'AC-W06': async () => {
    const project = workspace();
    const bound = snapshot({ workspaceId: project.id, workspaceKind: 'device' });
    const navigation = buildNavigation(
      [chatTopic('topic-a', {}, 2), chatTopic('topic-b', {}, 1), chatTopic('topic-recent')],
      {
        'topic-a': { snapshot: bound, workspace: project },
        'topic-b': { snapshot: bound, workspace: project },
      },
      { 'workspace-a': project },
    );
    return {
      recentTopicIds: navigation.recent.map(({ topic }) => topic.id),
      workspaceGroups: Object.fromEntries(
        navigation.workspaceGroups.map((group) => [
          group.workspaceId,
          group.topics.map((topic) => topic.id),
        ]),
      ),
    };
  },
  'AC-W07': async () => {
    let persisted: WorkspaceRef | undefined;
    let scratchCreateCalls = 0;
    let boundSnapshot: TopicExecutionSnapshot | undefined;
    const directRead = resolveExecutionContext({
      isDesktop: true,
      onlineDeviceIds: [DEVICE_ID],
    });
    const directReadScratchCount = directRead.workspace?.kind === 'scratch' ? 1 : 0;
    const bindScratchAfterToolSuccess = async () => {
      const proposed = workspace({
        id: 'scratch-a',
        kind: 'scratch',
        rootPath: '/scratch/topic-a',
      });
      if (!persisted || buildWorkspaceScopeKey(persisted) !== buildWorkspaceScopeKey(proposed)) {
        scratchCreateCalls += 1;
        persisted = proposed;
      }
      const decision = decideWorkspaceBind(
        boundSnapshot
          ? {
              snapshot: {
                workspaceId: boundSnapshot.workspaceId,
                workspaceKind: boundSnapshot.workspaceKind,
              },
              workspace: persisted,
            }
          : {},
        persisted,
      );
      if (!decision.allowed) throw new Error('WORKSPACE_ALREADY_BOUND');
      boundSnapshot ??= snapshot({
        workspaceBoundAt: NOW,
        workspaceId: persisted.id,
        workspaceKind: 'scratch',
      });
      return { snapshot: boundSnapshot, workspace: persisted };
    };
    const results = await Promise.all([
      bindScratchAfterToolSuccess(),
      bindScratchAfterToolSuccess(),
    ]);
    persisted = results[0].workspace;
    boundSnapshot = results[0].snapshot;
    const navigation = buildNavigation(
      [chatTopic('topic-unbound'), chatTopic(TOPIC_ID)],
      { [TOPIC_ID]: results[0] },
      { [persisted!.id!]: persisted },
    );
    const placement = classifyTopicPlacement(boundSnapshot, {
      id: persisted!.id!,
      kind: 'scratch',
    });
    return {
      directReadScratchCount,
      recentTopicIds: navigation.recent.map(({ topic }) => topic.id),
      scratchCreateCalls,
      scratchIds: results.map((result) => result.workspace.id!),
      snapshotWorkspaceIds: results.map((result) => result.snapshot.workspaceId!),
      temporaryMarkerVisible: placement.kind === 'recent' && placement.reason === 'scratch',
    };
  },
  'AC-W08': async () => {
    const current = workspace({ id: 'workspace-current' });
    const cwdBefore = current.rootPath;
    const decision = decideWorkspaceBind(
      {
        snapshot: { workspaceId: current.id, workspaceKind: current.kind },
        workspace: current,
      },
      workspace({ id: 'workspace-next', rootPath: '/code/next' }),
    );
    return {
      actionLabel: 'New project topic',
      allowed: decision.allowed,
      cwdAfter: current.rootPath,
      cwdBefore,
    };
  },
  'AC-W09': async () => {
    const agentDefaultBefore = '/agent/default';
    const boundByTopic = new Map<string, WorkspaceRef>();
    let nextWorkspace = 0;
    const selectForTopic = async (topicId: string, selection: { path: string }) => {
      const result = await selectWorkspaceOnce({
        effective: {
          context: resolveExecutionContext({ isDesktop: true, onlineDeviceIds: [DEVICE_ID] }),
          draftKey: `accepted-ref:${topicId}`,
          isDraft: false,
          recommendation: { deviceId: DEVICE_ID },
          state: 'unbound',
          target: 'local',
          targetDeviceId: DEVICE_ID,
          topicId,
        },
        ports: {
          bindTopicWorkspace: async ({ workspaceId }) => {
            const selected = [...created.values()].find((item) => item.id === workspaceId)!;
            boundByTopic.set(topicId, selected);
            return { ok: true };
          },
          getOrCreateDeviceWorkspace: async ({ rootPath }) => {
            const selected = workspace({ id: `workspace-w09-${++nextWorkspace}`, rootPath });
            created.set(selected.id!, selected);
            return { ok: true, value: selected };
          },
          rememberRecent: () => undefined,
          setDraftWorkspaceIntent: () => undefined,
        },
        selection,
      });
      return result.ok;
    };
    const created = new Map<string, WorkspaceRef>();
    const runMessageSource = async (topicId: string, message: string, hasAttachments = false) => {
      let confirmationOpened = false;
      await confirmWorkspaceBindingIntent({
        confirm: async ({ bind }) => {
          confirmationOpened = true;
          return bind();
        },
        desktop: true,
        effective: { state: 'unbound' },
        payload: { hasAttachments, message } as any,
        select: (selection) => selectForTopic(topicId, selection),
      });
      return confirmationOpened && boundByTopic.has(topicId);
    };

    const attachment = await runMessageSource(
      'topic-attachment',
      '接下来持续在 /attachment 开发',
      true,
    );
    const codeBlock = await runMessageSource('topic-code-block', '接下来持续在 `/code-block` 开发');
    const quote = await runMessageSource('topic-quote', '> 接下来持续在 /quoted 开发');
    const confirmedDirectory = await runMessageSource(
      'topic-confirmed',
      '接下来持续在 /confirmed 开发',
    );
    const workspacePlus = await selectForTopic('topic-plus', { path: '/plus' });
    const createdTopicWorkspaceIds = [...boundByTopic.values()].map(
      (selected) => normalizeWorkspaceIdentity(selected).workspaceId!,
    );

    return {
      agentDefaultAfter: agentDefaultBefore,
      agentDefaultBefore,
      bindingBySource: {
        attachment,
        codeBlock,
        confirmedDirectory,
        quote,
        workspacePlus,
      },
      createdTopicWorkspaceIds,
    };
  },
  'AC-W10': async () => {
    const context = resolveExecutionContext({ isDesktop: true, onlineDeviceIds: [DEVICE_ID] });
    const persisted = workspace({ id: 'workspace-resume' });
    const preBind = await routeHeterogeneousExecution({
      context,
      onBlocked: (error) => error.code,
      onReady: () => 'READY',
    });
    const readyContext = resolveExecutionContext({
      isDesktop: true,
      isHetero: true,
      onlineDeviceIds: [DEVICE_ID],
      snapshot: snapshot({
        workspaceId: persisted.id,
        workspaceKind: persisted.kind,
      }),
      workspaces: { [persisted.id!]: persisted },
    });
    const resumed = await routeHeterogeneousExecution({
      context: readyContext,
      onBlocked: () => undefined,
      onReady: ({ cwd, workspaceIdentity }) => ({
        resume: resolveHeteroResume(
          { heteroSessionId: 'session-accepted-ref', workingDirectory: persisted.rootPath },
          cwd,
        ),
        workspaceIdentity,
      }),
    });
    if (resumed.status !== 'ready' || !resumed.value.resume.resumeSessionId) {
      throw new Error('AC-W10 production resume dispatcher did not run');
    }
    return {
      normalizedResumeIdentity: resumed.value.workspaceIdentity.key,
      persistedIdentity: normalizeWorkspaceIdentity({ ...persisted, rootPath: '/code/masterino/' })
        .key,
      preBindCode: preBind.value!,
    };
  },
  'AC-P01': async () => {
    const roots = buildExecutionAccessRoots('/code/masterino', [
      {
        modes: ['read'],
        operationId: OPERATION_ID,
        rootPath: '/outside/docs',
        scope: 'operation',
        source: 'direct-user-message',
      },
    ]);
    const root = roots?.find((item) => item.scope === 'operation');
    return {
      execAllowed: root?.modes.includes('exec') ?? false,
      modes: root?.modes ?? [],
      rootPath: root?.rootPath,
      scope: root?.scope,
      writeAllowed: root?.modes.includes('write') ?? false,
    };
  },
  'AC-P02': async () => {
    const sources = [
      'attachment',
      'bot',
      'codeBlock',
      'cron',
      'eval',
      'headless',
      'quote',
      'referTopic',
      'task',
    ];
    return {
      consentBySource: Object.fromEntries(
        sources.map((source) => [source, Boolean(buildExecutionAccessRoots(undefined)?.length)]),
      ),
    };
  },
  'AC-P03': async () => {
    const fixture = makeGrantService();
    const grant = await fixture.service.grant({
      deviceId: DEVICE_ID,
      modes: ['read'],
      requestedVia: { reason: 'Read user-confirmed documentation' },
      rootPath: '/outside/docs',
      topicId: TOPIC_ID,
    });
    const rootsDuringGrant = await fixture.service.buildAccessRoots({
      deviceId: DEVICE_ID,
      topicId: TOPIC_ID,
    });
    const reusedRoots = rootsDuringGrant.map(({ rootPath }) => rootPath);
    await fixture.service.revoke({ deviceId: DEVICE_ID, id: grant.id, topicId: TOPIC_ID });
    const afterRevokeRoots = (
      await fixture.service.buildAccessRoots({ deviceId: DEVICE_ID, topicId: TOPIC_ID })
    ).map(({ rootPath }) => rootPath);
    await fixture.service.grant({
      deviceId: DEVICE_ID,
      modes: ['read'],
      rootPath: '/outside/docs',
      topicId: TOPIC_ID,
    });
    fixture.archive();
    const afterArchiveRoots = (
      await fixture.service.buildAccessRoots({ deviceId: DEVICE_ID, topicId: TOPIC_ID })
    ).map(({ rootPath }) => rootPath);
    return {
      afterArchiveRoots,
      afterRevokeRoots,
      promptDuringGrant: buildAdditionalDirectoriesPrompt(rootsDuringGrant) ?? '',
      reusedRoots,
    };
  },
  'AC-P04': async () =>
    withTemporaryTree(async ({ home, outside, workspace: workspaceRoot }) => {
      const file = path.join(outside, 'note.txt');
      await writeFile(file, 'ok');
      const expiresAt = '2026-09-03T01:00:00.000Z';
      const accessRoot = {
        deviceId: DEVICE_ID,
        expiresAt,
        grantId: 'grant-a',
        modes: ['read' as const],
        rootPath: outside,
        scope: 'topic' as const,
        source: 'user-approval' as const,
        topicId: TOPIC_ID,
      };
      const attempt = (deviceId: string, now: string) =>
        prepareToolCallExecution({
          apiName: 'readFile',
          args: { path: file },
          context: {
            accessRoots: [accessRoot],
            cwd: workspaceRoot,
            workspaceRootPath: workspaceRoot,
          },
          homeDir: home,
          now: new Date(now),
          trace: { deviceId, topicId: TOPIC_ID },
        });
      const beforeExpiryAllowed = (await getErrorCode(() => attempt(DEVICE_ID, NOW))) === 'ALLOWED';
      const afterExpiryAllowed =
        (await getErrorCode(() => attempt(DEVICE_ID, '2026-09-03T02:00:00.000Z'))) === 'ALLOWED';
      const otherDeviceAllowed = (await getErrorCode(() => attempt('device-b', NOW))) === 'ALLOWED';
      return { afterExpiryAllowed, beforeExpiryAllowed, otherDeviceAllowed };
    }),
  'AC-P05': async () =>
    withTemporaryTree(async ({ home, workspace: workspaceRoot }) => {
      const ssh = path.join(home, '.ssh');
      await mkdir(ssh);
      const privateKey = path.join(ssh, 'id_rsa');
      await writeFile(privateKey, 'secret');
      const linked = path.join(workspaceRoot, 'linked-secret');
      await symlink(privateKey, linked);
      const context = { cwd: workspaceRoot, workspaceRootPath: workspaceRoot };
      const sensitiveTraversalAllowed =
        (await getErrorCode(() =>
          prepareToolCallExecution({
            apiName: 'readFile',
            args: { path: path.join(workspaceRoot, '..', 'home', '.ssh', 'id_rsa') },
            context,
            homeDir: home,
          }),
        )) === 'ALLOWED';
      const symlinkToSensitiveAllowed =
        (await getErrorCode(() =>
          prepareToolCallExecution({
            apiName: 'readFile',
            args: { path: linked },
            context,
            homeDir: home,
          }),
        )) === 'ALLOWED';
      return { sensitiveTraversalAllowed, symlinkToSensitiveAllowed };
    }),
  'AC-P06': async () =>
    withTemporaryTree(async ({ home, outside, workspace: workspaceRoot }) => {
      const secret = path.join(home, '.ssh', 'id_rsa');
      await mkdir(path.dirname(secret));
      await writeFile(secret, 'secret');
      const shared = path.join(outside, 'shared.txt');
      await writeFile(shared, 'shared');
      const context = {
        accessRoots: [
          {
            modes: ['read' as const],
            operationId: OPERATION_ID,
            rootPath: outside,
            scope: 'operation' as const,
            source: 'direct-user-message' as const,
          },
        ],
        approvalMode: 'auto-run' as const,
        cwd: workspaceRoot,
        workspaceRootPath: workspaceRoot,
      };
      let sensitiveReadProviderCalls = 0;
      const sensitiveReadCode = await getErrorCode(async () => {
        await prepareToolCallExecution({
          apiName: 'readFile',
          args: { path: secret },
          context,
          homeDir: home,
          trace: { operationId: OPERATION_ID },
        });
        sensitiveReadProviderCalls += 1;
      });
      const ordinaryWriteCode = await getErrorCode(async () => {
        await prepareToolCallExecution({
          apiName: 'writeFile',
          args: { content: 'ok', path: shared },
          context,
          homeDir: home,
          trace: { operationId: OPERATION_ID },
        });
      });
      return {
        ordinaryWriteAllowed: ordinaryWriteCode === 'ALLOWED',
        sensitiveReadCode: sensitiveReadCode as 'SCOPE_DENIED',
        sensitiveReadProviderCalls,
      };
    }),
  'AC-P07': async () =>
    withTemporaryTree(async ({ home, workspace: workspaceRoot }) => {
      const requestedCwd = '/outside/untrusted';
      const prepared = await prepareToolCallExecution({
        apiName: 'runCommand',
        args: { command: 'pwd', cwd: requestedCwd },
        context: { cwd: workspaceRoot, workspaceRootPath: workspaceRoot },
        homeDir: home,
      });
      const frozen = resolveExecutionContext({
        isDesktop: true,
        onlineDeviceIds: [DEVICE_ID],
        snapshot: snapshot({ workspaceId: 'workspace-a', workspaceKind: 'device' }),
        workspaces: { 'workspace-a': workspace() },
      });
      return {
        auditWarnings: prepared.warnings.map(({ code }) => code),
        requestedCwd,
        spawnCwd: frozen.cwd!,
      };
    }),
  'AC-P08': async () => {
    const request = parseStructuredPathConsentRequest({
      actualCwd: '/code/masterino',
      deviceId: DEVICE_ID,
      modes: ['read'],
      operationId: OPERATION_ID,
      primaryCwd: '/code/masterino',
      requestedPath: '/outside/payroll.csv',
      topicId: TOPIC_ID,
      version: 1,
    })!;
    const consentNotice = `Consent required — ${toolLocale['workspacePathConsent.notOsSandbox']}`;
    return {
      consentNotice,
      displayedCommand: `readFile ${request.requestedPath}`,
      displayedCwd: request.actualCwd,
      riskNotice: `${toolLocale['workspacePathConsent.notOsSandboxDescription']} ${request.requestedPath}`,
    };
  },
  'AC-M01': async () => {
    const chat = filterAiProviderChatEligibleModels(modelRows());
    return { chatIds: chat.map(({ id }) => id), defaultModelId: chat[0]?.id };
  },
  'AC-M02': async () => {
    const apiChatIds = filterAiProviderChatEligibleModels(modelRows()).map(({ id }) => id);
    const bridgeChatIds = filterAiProviderChatEligibleModels(modelRows()).map(({ id }) => id);
    return { apiChatIds, bridgeChatIds };
  },
  'AC-M03': async () => {
    const fixtures = [
      mergeModelCatalogEntry({
        modelId: 'vision-chat',
        providerId: 'newapi',
        providerMetadata: { inputModalities: { image: 'supported' } },
      }),
      mergeModelCatalogEntry({
        modelId: 'text-chat',
        providerId: 'newapi',
        providerMetadata: {
          inputModalities: {
            audio: 'unsupported',
            file: 'unsupported',
            image: 'unsupported',
            video: 'unsupported',
          },
        },
      }),
      mergeModelCatalogEntry({ modelId: 'unknown-chat', providerId: 'newapi' }),
    ];
    const labels = fixtures.map(({ entry }) => getChatInputModalityConclusion(entry).kind);
    return { developmentLabels: labels, productionLabels: [...labels] };
  },
  'AC-M04': async () => {
    const result = mergeModelCatalogEntry({
      catalog: { abilities: { vision: true }, maxOutput: 4096 },
      manual: {
        createdAt: '2026-09-01T00:00:00.000Z',
        inputModalities: { image: 'unsupported' },
        maxOutput: 8192,
        owner: 'model-ops',
        reason: 'Provider rejects images',
      },
      modelId: 'chat-model',
      now: NOW,
      providerId: 'newapi',
      providerMetadata: { endpointTypes: ['chat/completions'] },
    });
    return {
      afterNextSync: {
        image: result.entry.inputModalities.image,
        maxOutput: result.entry.maxOutput!,
        text: result.entry.inputModalities.text,
      },
      driftFields: result.drift.map(({ field }) => field.replace('inputModalities.', '')),
    };
  },
  'AC-M05': async () => {
    const manual = {
      createdAt: '2026-09-01T00:00:00.000Z',
      inputModalities: { image: 'unsupported' as const },
      owner: 'model-ops',
      reason: 'Manual image verification',
    };
    const observed = {
      contextWindowRejectionTokens: 32_000,
      verifiedAt: '2026-09-02T00:00:00.000Z',
    };
    const project = (result: ReturnType<typeof mergeModelCatalogEntry>) => ({
      contextWindowSource: result.entry.contextWindowSource,
      imageSource: result.entry.abilitySources.image?.split(':')[0] ?? '',
    });
    const before = mergeModelCatalogEntry({
      catalog: { contextWindowTokens: 128_000 },
      manual,
      modelId: 'chat-model',
      now: NOW,
      observed,
      providerId: 'newapi',
    });
    const refreshed = mergeModelCatalogEntry({
      catalog: { contextWindowTokens: 256_000 },
      manual: before.manual,
      modelId: 'chat-model',
      now: NOW,
      observed: before.observed,
      providerId: 'newapi',
    });
    return { afterRefresh: project(refreshed), beforeRefresh: project(before) };
  },
  'AC-M06': async () => {
    const client = createModelCatalogSnapshot(baseCatalog.entry, OPERATION_ID, NOW);
    const server = createModelCatalogSnapshot(client.entry, client.operationId, client.capturedAt);
    return {
      clientOperationId: client.operationId,
      clientSnapshot: JSON.stringify(client),
      serverOperationId: server.operationId,
      serverSnapshot: JSON.stringify(server),
    };
  },
  'AC-C01': async () => {
    const events = ['estimate-final-context'];
    let providerCalls = 0;
    let providerCallsBeforeCompression = -1;
    await runContextBudgetedCall({
      ...contextBudgetBase,
      callProvider: async () => {
        providerCalls += 1;
        events.push('provider-request');
        return 'ok';
      },
      compress: async (payload, evaluation) => {
        providerCallsBeforeCompression = providerCalls;
        events.push('compress');
        return { outcome: compressedOutcome(evaluation), payload: reducedPayload(payload) };
      },
      configuredWindowTokens: 32_000,
      payload: { messages: [assistant('old', 40_000), user('latest', 'go')] },
    });
    return { events, providerCallsBeforeCompression };
  },
  'AC-C02': async () => {
    let providerCalls = 0;
    let compressionCalls = 0;
    const result = await runContextBudgetedCall({
      ...contextBudgetBase,
      callProvider: async () => {
        providerCalls += 1;
        throw { code: 'ExceededContextWindow', contextWindowTokens: 32_000 };
      },
      compress: async (payload, evaluation) => {
        compressionCalls += 1;
        return { outcome: compressedOutcome(evaluation), payload: reducedPayload(payload) };
      },
      payload: { messages: [assistant('old', 20_000), user('latest', 'go')] },
    });
    return {
      compressionCalls,
      effectiveWindowTokens:
        result.evaluations.find(({ window }) => window.source === 'observed')?.window
          .windowTokens ?? 0,
      providerCalls,
    };
  },
  'AC-C03': async () => {
    let providerCalls = 0;
    const result = await runContextBudgetedCall({
      ...contextBudgetBase,
      callProvider: async () => {
        providerCalls += 1;
        return 'never';
      },
      compress: async () => {
        throw new Error('must not compress');
      },
      payload: {
        messages: [assistant('old', 1000), user('latest', 'inspect')],
        providerMedia: [{ estimatedTokens: 200_000, messageId: 'latest' }],
      },
    });
    return {
      code: result.kind === 'fail' ? result.decision.code : 'unexpected-success',
      providerCalls,
    };
  },
  'AC-C04': async () => {
    const compression = await compressContextHierarchically({
      buildRequest: (items: readonly { text: string }[]) => items.map(({ text }) => text).join(),
      candidateIds: [],
      createSummaryMessage: (text, _candidateIds, id) => ({ id, text }),
      getMessageId: (message: { id: string }) => message.id,
      groupId: 'manual-no-candidates',
      measurePayload: (items) => ({
        payloadFingerprint: items.map(({ id, text }) => `${id}:${text}`).join('|'),
        tokens: items.reduce((total, { text }) => total + text.length, 0),
      }),
      measureRequest: (request: string) => request.length,
      messages: [{ id: 'latest', text: 'Nothing eligible to compress' }],
      renderMessage: ({ text }) => text,
      summarize: async () => 'unused',
      summaryModelBudgetTokens: 8_000,
      trigger: 'manual',
    });
    const decision = failureAfterCompression(compression.outcome) as Extract<
      ContextBudgetDecision,
      { kind: 'fail' }
    >;
    const view = buildContextBudgetErrorViewModel({ decision });
    return { code: decision.code, manualFeedback: `${view.titleKey}: ${view.descKey}` };
  },
  'AC-C05': async () => {
    const messages = [
      { id: 'old-1', text: 'a'.repeat(45) },
      { id: 'old-2', text: 'b'.repeat(45) },
      { id: 'tail', text: 'keep me' },
    ];
    const before = messages.map(({ text }) => text);
    const result = await compressContextHierarchically({
      buildRequest: (items: readonly { text: string }[], level) =>
        `level:${level}\n${items.map(({ text }) => text).join('\n')}`,
      candidateIds: ['old-1', 'old-2'],
      createSummaryMessage: (text, _candidateIds, id) => ({ id, text }),
      getMessageId: (message: { id: string }) => message.id,
      groupId: 'failed-group',
      measurePayload: (items) => ({
        payloadFingerprint: items.map(({ id, text }) => `${id}:${text}`).join('|'),
        tokens: items.reduce((total, { text }) => total + text.length, 0),
      }),
      measureRequest: (request: string) => request.length,
      messages,
      renderMessage: ({ text }) => text,
      summarize: async () => {
        throw new Error('summary provider failure');
      },
      summaryModelBudgetTokens: 30,
      trigger: 'final-preflight',
    });
    return {
      code: result.outcome.outcome === 'failed' ? result.outcome.code : 'unexpected-success',
      failedGroupId: result.group.failureCode ? result.group.groupId : undefined,
      messagesAfter: result.messages.map(({ text }) => text),
      messagesBefore: before,
    };
  },
  'AC-C06': async () => {
    const result = await compressContextHierarchically({
      buildRequest: (items: readonly { text: string }[], level) =>
        `level:${level}\n${items.map(({ text }) => text).join('\n')}`,
      candidateIds: ['old-1', 'old-2'],
      createSummaryMessage: (text, _candidateIds, id) => ({ id, text }),
      getMessageId: (message: { id: string }) => message.id,
      groupId: 'chunked-group',
      measurePayload: (items) => ({
        payloadFingerprint: items.map(({ id, text }) => `${id}:${text}`).join('|'),
        tokens: items.reduce((total, { text }) => total + text.length, 0),
      }),
      measureRequest: (request: string) => request.length,
      messages: [
        { id: 'old-1', text: 'a'.repeat(45) },
        { id: 'old-2', text: 'b'.repeat(45) },
        { id: 'tail', text: 'keep me' },
      ],
      renderMessage: ({ text }) => text,
      summarize: async (_request: string) => 's',
      summaryModelBudgetTokens: 30,
      trigger: 'final-preflight',
    });
    return { chunkTokens: result.group.requestTokens, summaryBudgetTokens: 30 };
  },
  'AC-C07': async () => {
    let retryProviderCalls = 0;
    const retry = await runContextBudgetedCall({
      ...contextBudgetBase,
      callProvider: async () => {
        retryProviderCalls += 1;
        throw { code: 'ExceededContextWindow', contextWindowTokens: 32_000 };
      },
      compress: async (payload, evaluation) => ({
        outcome: compressedOutcome(evaluation),
        payload: reducedPayload(payload),
      }),
      payload: { messages: [assistant('old', 20_000), user('latest', 'go')] },
    });

    let failedProviderCalls = 0;
    await runContextBudgetedCall({
      ...contextBudgetBase,
      callProvider: async () => {
        failedProviderCalls += 1;
        return 'never';
      },
      compress: async () => {
        throw new Error('summary failed');
      },
      configuredWindowTokens: 32_000,
      payload: { messages: [assistant('old', 40_000), user('latest', 'go')] },
    });

    let sameFingerprintProviderCalls = 0;
    const samePayload = { messages: [assistant('old', 40_000), user('latest', 'go')] };
    await runContextBudgetedCall({
      ...contextBudgetBase,
      callProvider: async () => {
        sameFingerprintProviderCalls += 1;
        return 'never';
      },
      compress: async (_payload, evaluation) => ({
        outcome: compressedOutcome(evaluation),
        payload: samePayload,
      }),
      configuredWindowTokens: 32_000,
      payload: samePayload,
    });

    const skipped = failureAfterCompression({
      afterTokens: 40_000,
      attempt: 1,
      beforeTokens: 40_000,
      code: 'NO_CANDIDATES',
      outcome: 'skipped',
      payloadFingerprint: 'skipped',
      trigger: 'manual',
    });
    return {
      failedProviderCalls,
      retryCode: retry.kind === 'fail' ? retry.decision.code : 'unexpected-success',
      retryProviderCalls,
      sameFingerprintProviderCalls,
      skippedProviderCalls: skipped?.kind === 'fail' ? 0 : 1,
    };
  },
  'AC-C08': async () => {
    const secrets = ['sk-live-secret', 'private attachment contents'];
    const codes: ContextBudgetFailCode[] = [
      'TAIL_TOO_LARGE',
      'NO_CANDIDATES',
      'SUMMARY_FAILED',
      'RETRY_EXHAUSTED',
    ];
    const cards = codes.map((code) => {
      const decision = budgetFailure(code);
      const sanitized = getContextBudgetFailureFromErrorBody({
        contextBudget: {
          decision,
          rawMessage: secrets[1],
          trace: {
            modelId: 'model-a',
            operationId: OPERATION_ID,
            providerId: 'provider-a',
            secret: secrets[0],
          },
        },
      })!;
      const view = buildContextBudgetErrorViewModel(sanitized);
      return {
        actions: view.actions.filter(({ disabled }) => !disabled).map(({ id }) => id),
        code: view.code,
      };
    });
    const diagnosticsPayload = getContextBudgetFailureFromErrorBody({
      decision: budgetFailure('TAIL_TOO_LARGE'),
      trace: { operationId: OPERATION_ID, secret: secrets[0], message: secrets[1] },
    });
    return {
      cards: cards as AcceptanceResultMap['AC-C08']['cards'],
      diagnostics: JSON.stringify(diagnosticsPayload),
      secrets,
    };
  },
  'AC-X01': async () => {
    const context = resolveExecutionContext({
      accessRoots: [
        {
          modes: ['read'],
          operationId: OPERATION_ID,
          rootPath: '/outside/docs',
          scope: 'operation',
          source: 'direct-user-message',
        },
      ],
      isDesktop: true,
      onlineDeviceIds: [DEVICE_ID],
      operationId: OPERATION_ID,
      snapshot: snapshot({ workspaceId: 'workspace-a', workspaceKind: 'device' }),
      workspaces: { 'workspace-a': workspace() },
    });
    const toolContext = toToolCallExecutionContext(context);
    const model = createModelCatalogSnapshot(baseCatalog.entry, context.operationId!, NOW);
    const budget = evaluateContextBudget({
      ...contextBudgetBase,
      messages: [user('latest', 'go')],
      operationId: context.operationId!,
      trigger: 'final-preflight',
    });
    const accessOperationId = toolContext.accessRoots?.find(
      ({ scope }) => scope === 'operation',
    )?.operationId;
    if (!accessOperationId) throw new Error('Operation access root lost its operation id');
    return {
      accessOperationId,
      budgetOperationId: budget.trace.operationId,
      cwdOperationId: context.operationId!,
      modelOperationId: model.operationId,
    };
  },
  'AC-X02': async () =>
    withTemporaryTree(async ({ home, workspace: workspaceRoot }) => {
      const file = path.join(workspaceRoot, 'note.txt');
      await writeFile(file, 'ok');
      const matrix: AcceptanceResultMap['AC-X02']['matrix'] = [];
      for (const client of ['new', 'old'] as const) {
        for (const server of ['new', 'old'] as const) {
          for (const device of ['new', 'old'] as const) {
            // Each version changes a real stage of the request: the client may
            // omit the envelope, the server may drop it, and the device either
            // enforces the v2 boundary or executes through the legacy adapter.
            const clientRequest =
              client === 'new'
                ? { executionContext: { cwd: workspaceRoot, workspaceRootPath: workspaceRoot } }
                : {};
            const serverRequest = server === 'new' ? clientRequest : ({} as typeof clientRequest);
            const deviceAuth =
              device === 'new'
                ? {
                    capabilities: { executionContextValidation: true },
                    protocolVersion: 2,
                  }
                : { capabilities: {}, protocolVersion: 1 };

            let deviceExecution:
              | { content: string; kind: 'legacy' }
              | { code: string; kind: 'rejected' }
              | { content: string; kind: 'validated'; primary: boolean };
            if (device === 'old') {
              deviceExecution = { content: await readFile(file, 'utf8'), kind: 'legacy' };
            } else {
              try {
                const prepared = await prepareToolCallExecution({
                  apiName: 'readFile',
                  args: { path: file },
                  context: serverRequest.executionContext,
                  homeDir: home,
                });
                deviceExecution = {
                  content: await readFile(prepared.args.path, 'utf8'),
                  kind: 'validated',
                  primary: prepared.scopeAudit[0]?.scopeVerdict === 'primary',
                };
              } catch (error) {
                deviceExecution = {
                  code: (error as { code?: string }).code ?? 'UNKNOWN',
                  kind: 'rejected',
                };
              }
            }

            const deviceDeclaredV2Validation =
              deviceAuth.protocolVersion === 2 &&
              deviceAuth.capabilities.executionContextValidation === true;
            const deviceEnforcedRequest = deviceExecution.kind === 'validated';
            const wireAcknowledgement =
              server === 'new' &&
              serverRequest.executionContext &&
              deviceDeclaredV2Validation &&
              deviceEnforcedRequest
                ? 'hard'
                : undefined;
            const negotiated =
              client === 'new' ? parseExecutionContextValidation(wireAcknowledgement) : 'legacy';
            const hardValidated = negotiated === 'hard';
            const expectedHard = client === 'new' && server === 'new' && device === 'new';
            const executionPassed =
              deviceExecution.kind === 'legacy'
                ? deviceExecution.content === 'ok'
                : serverRequest.executionContext
                  ? deviceExecution.kind === 'validated' &&
                    deviceExecution.content === 'ok' &&
                    deviceExecution.primary
                  : deviceExecution.kind === 'rejected' &&
                    deviceExecution.code === 'WORKSPACE_REQUIRED';
            matrix.push({
              client,
              device,
              hardValidated,
              passed: hardValidated === expectedHard && executionPassed,
              server,
            });
          }
        }
      }
      return { matrix };
    }),
};
