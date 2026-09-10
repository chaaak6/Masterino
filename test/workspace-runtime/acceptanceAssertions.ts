import { describe, expect, it } from 'vitest';

import { acceptanceMatrix } from './acceptanceMatrix';
import type { AcceptanceId, WorkspaceRuntimeAcceptanceAdapter } from './contracts';

interface AcceptanceCase {
  id: AcceptanceId;
  verify: (adapter: WorkspaceRuntimeAcceptanceAdapter) => Promise<void>;
}

const cases: AcceptanceCase[] = [
  {
    id: 'AC-W01',
    verify: async (adapter) => {
      expect(await adapter['AC-W01']()).toEqual({ draftTarget: 'local' });
    },
  },
  {
    id: 'AC-W02',
    verify: async (adapter) => {
      expect(await adapter['AC-W02']()).toEqual({
        desktopDraftTarget: 'local',
        persistedDesktopTarget: 'sandbox',
        webDraftTarget: 'sandbox',
      });
    },
  },
  {
    id: 'AC-W03',
    verify: async (adapter) => {
      expect(await adapter['AC-W03']()).toEqual({
        devicePlanKind: 'device-unrouted',
        deviceTarget: 'device',
        localPlanKind: 'device-unrouted',
        localTarget: 'local',
      });
    },
  },
  {
    id: 'AC-W04',
    verify: async (adapter) => {
      const observed = await adapter['AC-W04']();
      expect(observed.projectWorkspaceRowsAfter).toBe(observed.projectWorkspaceRowsBefore);
      expect(observed.scratchDirectoriesAfter).toEqual(observed.scratchDirectoriesBefore);
    },
  },
  {
    id: 'AC-W05',
    verify: async (adapter) => {
      const observed = await adapter['AC-W05']();
      expect(observed.topLevelTopicVisible).toBe(true);
      expect(observed.recentTopicIds).toContain('topic-unbound');
      expect(observed.taskListCountAfter).toBe(observed.taskListCountBefore);
      expect(observed.taskTopicRowsAfter).toBe(observed.taskTopicRowsBefore);
      expect(observed.taskUiLabelsAfter).toEqual(observed.taskUiLabelsBefore);
    },
  },
  {
    id: 'AC-W06',
    verify: async (adapter) => {
      const observed = await adapter['AC-W06']();
      expect(observed.workspaceGroups['workspace-a']).toEqual(['topic-a', 'topic-b']);
      expect(observed.recentTopicIds).not.toEqual(expect.arrayContaining(['topic-a', 'topic-b']));
    },
  },
  {
    id: 'AC-W07',
    verify: async (adapter) => {
      const observed = await adapter['AC-W07']();
      expect(observed.directReadScratchCount).toBe(0);
      expect(observed.scratchCreateCalls).toBe(1);
      expect(new Set(observed.scratchIds)).toHaveLength(1);
      expect(new Set(observed.snapshotWorkspaceIds)).toEqual(new Set(observed.scratchIds));
      expect(observed.recentTopicIds).toContain('topic-unbound');
      expect(observed.temporaryMarkerVisible).toBe(true);
    },
  },
  {
    id: 'AC-W08',
    verify: async (adapter) => {
      const observed = await adapter['AC-W08']();
      expect(observed.allowed).toBe(false);
      expect(observed.cwdAfter).toBe(observed.cwdBefore);
      expect(observed.actionLabel).toMatch(/new project topic|新建项目话题/i);
    },
  },
  {
    id: 'AC-W09',
    verify: async (adapter) => {
      const observed = await adapter['AC-W09']();
      expect(observed.agentDefaultAfter).toBe(observed.agentDefaultBefore);
      expect(observed.bindingBySource).toMatchObject({
        attachment: false,
        codeBlock: false,
        confirmedDirectory: true,
        quote: false,
        workspacePlus: true,
      });
      expect(observed.createdTopicWorkspaceIds).toHaveLength(2);
    },
  },
  {
    id: 'AC-W10',
    verify: async (adapter) => {
      const observed = await adapter['AC-W10']();
      expect(observed.preBindCode).toBe('WORKSPACE_REQUIRED');
      expect(observed.normalizedResumeIdentity).toBe(observed.persistedIdentity);
      expect(observed.normalizedResumeIdentity).toMatch(
        /^id:[^:]+:(device|sandbox|scratch):[^:]+:\//,
      );
    },
  },
  {
    id: 'AC-P01',
    verify: async (adapter) => {
      expect(await adapter['AC-P01']()).toEqual({
        execAllowed: false,
        modes: ['read'],
        rootPath: '/outside/docs',
        scope: 'operation',
        writeAllowed: false,
      });
    },
  },
  {
    id: 'AC-P02',
    verify: async (adapter) => {
      const observed = await adapter['AC-P02']();
      expect(Object.keys(observed.consentBySource).sort()).toEqual(
        [
          'attachment',
          'bot',
          'codeBlock',
          'cron',
          'eval',
          'headless',
          'quote',
          'referTopic',
          'task',
        ].sort(),
      );
      expect(Object.values(observed.consentBySource).every((allowed) => !allowed)).toBe(true);
    },
  },
  {
    id: 'AC-P03',
    verify: async (adapter) => {
      const observed = await adapter['AC-P03']();
      expect(observed.reusedRoots).toContain('/outside/docs');
      expect(observed.promptDuringGrant).toContain('/outside/docs');
      expect(observed.afterRevokeRoots).not.toContain('/outside/docs');
      expect(observed.afterArchiveRoots).not.toContain('/outside/docs');
    },
  },
  {
    id: 'AC-P04',
    verify: async (adapter) => {
      expect(await adapter['AC-P04']()).toEqual({
        afterExpiryAllowed: false,
        beforeExpiryAllowed: true,
        otherDeviceAllowed: false,
      });
    },
  },
  {
    id: 'AC-P05',
    verify: async (adapter) => {
      expect(await adapter['AC-P05']()).toEqual({
        sensitiveTraversalAllowed: false,
        symlinkToSensitiveAllowed: false,
      });
    },
  },
  {
    id: 'AC-P06',
    verify: async (adapter) => {
      expect(await adapter['AC-P06']()).toEqual({
        ordinaryWriteAllowed: true,
        sensitiveReadCode: 'SCOPE_DENIED',
        sensitiveReadProviderCalls: 0,
      });
    },
  },
  {
    id: 'AC-P07',
    verify: async (adapter) => {
      const observed = await adapter['AC-P07']();
      expect(observed.spawnCwd).not.toBe(observed.requestedCwd);
      expect(observed.spawnCwd).toBe('/code/masterino');
      expect(observed.auditWarnings).toEqual(['MODEL_CWD_OVERRIDDEN']);
      expect(observed.auditWarnings.join('\n')).not.toContain(observed.requestedCwd);
    },
  },
  {
    id: 'AC-P08',
    verify: async (adapter) => {
      const observed = await adapter['AC-P08']();
      expect(observed.consentNotice).toMatch(/consent|同意/i);
      expect(observed.consentNotice).toMatch(/not.*isolation|不是.*隔离/i);
      expect(observed.displayedCwd).toBe('/code/masterino');
      expect(observed.displayedCommand).toContain('/outside/payroll.csv');
      expect(observed.riskNotice).toContain('/outside/payroll.csv');
    },
  },
  {
    id: 'AC-M01',
    verify: async (adapter) => {
      const observed = await adapter['AC-M01']();
      const forbidden = ['qwen3-vl-rerank', 'bge-reranker-v2', 'text-embedding-3-small'];
      expect(observed.chatIds).not.toEqual(expect.arrayContaining(forbidden));
      expect(forbidden).not.toContain(observed.defaultModelId);
      expect(observed.chatIds).toContain('qwen3-vl-plus');
    },
  },
  {
    id: 'AC-M02',
    verify: async (adapter) => {
      const observed = await adapter['AC-M02']();
      expect(observed.bridgeChatIds).toEqual(observed.apiChatIds);
      expect(observed.bridgeChatIds).toEqual(['qwen3-vl-plus']);
    },
  },
  {
    id: 'AC-M03',
    verify: async (adapter) => {
      const observed = await adapter['AC-M03']();
      expect(observed.productionLabels).toEqual(['supported', 'text-only', 'unknown']);
      expect(observed.developmentLabels).toEqual(observed.productionLabels);
    },
  },
  {
    id: 'AC-M04',
    verify: async (adapter) => {
      const observed = await adapter['AC-M04']();
      expect(observed.afterNextSync).toEqual({
        image: 'unsupported',
        maxOutput: 8192,
        text: 'supported',
      });
      expect(observed.driftFields).toContain('image');
    },
  },
  {
    id: 'AC-M05',
    verify: async (adapter) => {
      const observed = await adapter['AC-M05']();
      expect(observed.afterRefresh).toEqual(observed.beforeRefresh);
      expect(observed.afterRefresh).toMatchObject({
        contextWindowSource: 'observed',
        imageSource: 'manual',
      });
    },
  },
  {
    id: 'AC-M06',
    verify: async (adapter) => {
      const observed = await adapter['AC-M06']();
      expect(observed.clientOperationId).toBe(observed.serverOperationId);
      expect(observed.clientSnapshot).toBe(observed.serverSnapshot);
    },
  },
  {
    id: 'AC-C01',
    verify: async (adapter) => {
      const observed = await adapter['AC-C01']();
      expect(observed.providerCallsBeforeCompression).toBe(0);
      expect(observed.events.indexOf('compress')).toBeGreaterThan(
        observed.events.indexOf('estimate-final-context'),
      );
      expect(observed.events.indexOf('provider-request')).toBeGreaterThan(
        observed.events.indexOf('compress'),
      );
    },
  },
  {
    id: 'AC-C02',
    verify: async (adapter) => {
      expect(await adapter['AC-C02']()).toEqual({
        compressionCalls: 1,
        effectiveWindowTokens: 32_000,
        providerCalls: 2,
      });
    },
  },
  {
    id: 'AC-C03',
    verify: async (adapter) => {
      expect(await adapter['AC-C03']()).toEqual({ code: 'TAIL_TOO_LARGE', providerCalls: 0 });
    },
  },
  {
    id: 'AC-C04',
    verify: async (adapter) => {
      const observed = await adapter['AC-C04']();
      expect(observed.code).toBe('NO_CANDIDATES');
      expect(observed.manualFeedback.trim().length).toBeGreaterThan(0);
    },
  },
  {
    id: 'AC-C05',
    verify: async (adapter) => {
      const observed = await adapter['AC-C05']();
      expect(observed.code).toBe('SUMMARY_FAILED');
      expect(observed.messagesAfter).toEqual(observed.messagesBefore);
      expect(observed.failedGroupId).toBeTruthy();
    },
  },
  {
    id: 'AC-C06',
    verify: async (adapter) => {
      const observed = await adapter['AC-C06']();
      expect(observed.chunkTokens.length).toBeGreaterThan(1);
      expect(Math.max(...observed.chunkTokens)).toBeLessThanOrEqual(observed.summaryBudgetTokens);
    },
  },
  {
    id: 'AC-C07',
    verify: async (adapter) => {
      expect(await adapter['AC-C07']()).toEqual({
        failedProviderCalls: 0,
        retryCode: 'RETRY_EXHAUSTED',
        retryProviderCalls: 2,
        sameFingerprintProviderCalls: 0,
        skippedProviderCalls: 0,
      });
    },
  },
  {
    id: 'AC-C08',
    verify: async (adapter) => {
      const observed = await adapter['AC-C08']();
      expect(observed.cards).toEqual([
        {
          actions: ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'],
          code: 'TAIL_TOO_LARGE',
        },
        {
          actions: ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'],
          code: 'NO_CANDIDATES',
        },
        {
          actions: ['retry_compression', 'switch_compression_model', 'switch_model', 'fork_topic'],
          code: 'SUMMARY_FAILED',
        },
        { actions: ['switch_model', 'fork_topic'], code: 'RETRY_EXHAUSTED' },
      ]);
      const cardsByCode = Object.fromEntries(
        observed.cards.map(({ actions, code }) => [code, actions]),
      );
      expect(cardsByCode.NO_CANDIDATES).not.toContain('retry_compression');
      expect(cardsByCode.SUMMARY_FAILED).toEqual(
        expect.arrayContaining(['retry_compression', 'switch_compression_model']),
      );
      expect(cardsByCode.RETRY_EXHAUSTED).not.toContain('retry_compression');
      for (const secret of observed.secrets) expect(observed.diagnostics).not.toContain(secret);
    },
  },
  {
    id: 'AC-X01',
    verify: async (adapter) => {
      const observed = await adapter['AC-X01']();
      expect(
        new Set([
          observed.cwdOperationId,
          observed.accessOperationId,
          observed.modelOperationId,
          observed.budgetOperationId,
        ]),
      ).toHaveLength(1);
    },
  },
  {
    id: 'AC-X02',
    verify: async (adapter) => {
      const observed = await adapter['AC-X02']();
      expect(observed.matrix).toHaveLength(8);
      expect(observed.matrix.every(({ passed }) => passed)).toBe(true);
      expect(
        observed.matrix
          .filter(({ client, device, server }) =>
            client === 'old' || device === 'old' || server === 'old',
          )
          .every(({ hardValidated }) => !hardValidated),
      ).toBe(true);
      expect(
        observed.matrix.find(
          ({ client, device, server }) =>
            client === 'new' && device === 'new' && server === 'new',
        )?.hardValidated,
      ).toBe(true);
    },
  },
];

export const registerWorkspaceRuntimeAcceptance = (
  label: string,
  adapter: WorkspaceRuntimeAcceptanceAdapter,
) => {
  describe(label, () => {
    for (const acceptanceCase of cases) {
      const metadata = acceptanceMatrix.find(({ testId }) => testId === acceptanceCase.id);
      it(`${acceptanceCase.id} ${metadata?.observable ?? ''}`, async () => {
        await acceptanceCase.verify(adapter);
      });
    }
  });
};

export const registeredAcceptanceIds = cases.map(({ id }) => id);
