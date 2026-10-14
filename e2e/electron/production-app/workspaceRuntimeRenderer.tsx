import type { ContextBudgetFailCode } from '@lobechat/types/src/contextBudget';
import { MotionProvider } from '@lobehub/ui';
import { App as AntdApp } from 'antd';
import * as m from 'motion/react-m';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';

import { useBindWorkspaceOnce } from '@/features/ChatInput/ControlBar/useBindWorkspaceOnce';
import WorkspaceChip from '@/features/ChatInput/ControlBar/WorkspaceChip';
import { ConversationProvider } from '@/features/Conversation/ConversationProvider';
import ContextBudgetErrorCard from '@/features/Conversation/Error/ContextBudgetError/ContextBudgetErrorCard';
import Intervention from '@/features/Conversation/Messages/AssistantGroup/Tool/Detail/Intervention';
import CompressionProgress from '@/features/Conversation/Messages/CompressedGroup/CompressionProgress';
import {
  buildContextBudgetErrorViewModel,
  type ContextBudgetUIAction,
  getContextBudgetFailureFromErrorBody,
} from '@/features/Conversation/utils/contextBudgetView';
import { resolveExecutionContext } from '@/helpers/executionContext';
import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';
import SidebarBody from '@/routes/(main)/agent/_layout/Sidebar/Body';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { buildDraftConversationKey } from '@/store/projectWorkspace';

import { createWorkspaceRuntimeI18n } from './workspaceRuntimeI18n';
import { StreamRecoveryHarness } from './streamRecoveryRenderer';
import { ModelCapabilityRows } from './workspaceRuntimeModels';
import type { ElectronAcceptanceResultMap } from './workspaceRuntimeSeams';
import { AGENT_ID, DEVICE_ID } from './workspaceRuntimeTrpcClient';

const i18n = createWorkspaceRuntimeI18n();

/**
 * Preload bridge into the Electron main process, where the production
 * Workspace Runtime seams execute against the repository's isolated PGlite
 * database and a unique temporary filesystem. The runs are memoized in the
 * preload, so the UI below and the Playwright spec observe the same single
 * execution of each acceptance row.
 */
interface WorkspaceRuntimeBridge {
  run: <Id extends keyof ElectronAcceptanceResultMap>(
    acceptanceId: Id,
  ) => Promise<ElectronAcceptanceResultMap[Id]>;
}

const workspaceRuntimeBridge = (
  window as unknown as { masterinoElectronE2E?: { workspaceRuntime?: WorkspaceRuntimeBridge } }
).masterinoElectronE2E?.workspaceRuntime;

const useAcceptanceRow = <Id extends keyof ElectronAcceptanceResultMap>(acceptanceId: Id) => {
  const [row, setRow] = useState<ElectronAcceptanceResultMap[Id]>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    if (!workspaceRuntimeBridge) {
      setFailure('The Workspace Runtime preload bridge is missing');
      return;
    }
    workspaceRuntimeBridge
      .run(acceptanceId)
      .then(setRow)
      .catch((error: unknown) =>
        setFailure(error instanceof Error ? error.message : String(error)),
      );
  }, [acceptanceId]);

  return { failure, row };
};

/**
 * Seed conversation identity only — the two things a signed-in desktop session
 * would already hold: which agent is open and which topic the route points at.
 *
 * Nothing else is seeded. Topic rows and workspace rows are fetched by the
 * production hooks through the production stores, SWR and services, and only
 * the TRPC transport is deterministic (see `workspaceRuntimeTrpcClient`). If
 * any of that production wiring is disconnected the sidebar stays empty and
 * the spec fails.
 */
const seedProductionSessionIdentity = () => {
  useAgentStore.setState({ activeAgentId: AGENT_ID });
  useChatStore.setState({ activeAgentId: AGENT_ID, activeTopicId: 'topic-scratch' });
  useElectronStore.setState({
    gatewayDeviceInfo: {
      description: 'Electron production E2E device',
      deviceId: DEVICE_ID,
      hostname: 'electron-e2e.local',
      name: 'Electron E2E',
      platform: 'darwin',
    },
  });
};

seedProductionSessionIdentity();

const secret = {
  attachment: 'payroll-2026-Q3-CONFIDENTIAL.xlsx',
  message: 'password=hunter2-super-secret',
  toolResult: 'apiKey=AKIA-SECRET-TOOL-RESULT',
  url: 'https://files.internal.example/payroll.xlsx?token=sk-live-9f8e7d',
};

const failureBody = (code: ContextBudgetFailCode) => ({
  attachments: [{ name: secret.attachment, url: secret.url }],
  contextBudget: {
    decision: {
      actions: ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'],
      code,
      kind: 'fail',
      offending: [
        { content: secret.toolResult, estimatedTokens: 120_000, source: 'tool-result' },
        { content: secret.message, estimatedTokens: 30_000, source: 'attachment' },
      ],
    },
    trace: {
      attempt: 1,
      effectiveWindowSource: 'assumed',
      effectiveWindowTokens: 32_000,
      estimatedPromptTokens: 150_000,
      modelId: 'masterino-chat',
      providerId: 'aihub',
      rawPrompt: secret.message,
      warnings: ['WINDOW_UNKNOWN'],
    },
  },
  message: secret.message,
  toolResult: secret.toolResult,
});

const failureViewModel = (code: ContextBudgetFailCode) => {
  const payload = getContextBudgetFailureFromErrorBody(failureBody(code));
  if (!payload) throw new Error(`Could not build ${code} context-budget fixture`);
  return buildContextBudgetErrorViewModel(payload);
};

const ContextBudgetCards = () => {
  const [lastAction, setLastAction] = useState<ContextBudgetUIAction>();

  return (
    <section data-last-action={lastAction} data-testid="context-budget-cards">
      {(['TAIL_TOO_LARGE', 'NO_CANDIDATES', 'SUMMARY_FAILED', 'RETRY_EXHAUSTED'] as const).map(
        (code) => (
          <div data-context-budget-code={code} key={code}>
            <ContextBudgetErrorCard
              viewModel={failureViewModel(code)}
              onAction={(action) => setLastAction(action)}
            />
          </div>
        ),
      )}
    </section>
  );
};

/**
 * AC-W08 — the production bind-once chip, rendered from the rows the main
 * process read back out of `topics.metadata` and `project_workspaces` after a
 * real rebind attempt was rejected by `DatabaseTopicWorkspaceBindingStore`.
 * Only `bind.error` is injected, and it carries the code that rejection
 * actually produced.
 */
const BindOnceChip = ({ row }: { row: ElectronAcceptanceResultMap['AC-W08'] }) => {
  const workspaces = row.workspaceAfter?.id ? { [row.workspaceAfter.id]: row.workspaceAfter } : {};
  const context = resolveExecutionContext({
    isDesktop: true,
    onlineDeviceIds: [row.deviceId],
    snapshot: row.snapshotAfter,
    workspaces,
  });
  const effective: EffectiveWorkspace = {
    context,
    cwd: context.cwd,
    draftKey: buildDraftConversationKey({ agentId: AGENT_ID }),
    isDraft: false,
    recommendation: { deviceId: row.deviceId },
    state: context.workspace
      ? context.workspace.kind === 'scratch'
        ? 'scratch'
        : 'bound'
      : 'unbound',
    target: 'local',
    targetDeviceId: row.deviceId,
    topicId: row.topicId,
    workspace: context.workspace,
  };
  const bind = useBindWorkspaceOnce(effective, AGENT_ID);

  return (
    <div data-bound-workspace-id={row.boundWorkspaceIdAfter} data-cwd={context.cwd}>
      <WorkspaceChip
        bind={{ ...bind, error: { code: row.rejectionCode } } as typeof bind}
        effective={effective}
      />
    </div>
  );
};

const BindOnceSection = () => {
  const { failure, row } = useAcceptanceRow('AC-W08');

  return (
    <section data-state={row ? 'ready' : (failure ?? 'loading')} data-testid="workspace-bind-once">
      {row && <BindOnceChip row={row} />}
      {failure && <p role="alert">{failure}</p>}
    </section>
  );
};

/**
 * AC-P08 — the production consent surface, built from the runtime-authored
 * request the Electron main process produced from a real device-boundary
 * denial, plus the production argument view that shows the full shell command
 * and the model-supplied directory.
 */
const PathConsentSection = () => {
  const { failure, row } = useAcceptanceRow('AC-P08');
  const shellMessage = row?.consentToolMessages.find(
    (message) => message.tool_call_id === 'tool-call-p08-shell',
  );
  const readMessage = row?.consentToolMessages.find(
    (message) => message.tool_call_id === 'tool-call-p08-read',
  );

  const renderIntervention = (message: NonNullable<typeof shellMessage>) => {
    if (!message.plugin || !message.tool_call_id) return null;
    return (
      <Intervention
        apiName={message.plugin.apiName}
        id={message.id}
        identifier={message.plugin.identifier}
        requestArgs={message.plugin.arguments}
        toolCallId={message.tool_call_id}
      />
    );
  };

  return (
    <section
      data-testid="workspace-path-consent-surface"
      data-state={
        row ? (shellMessage && readMessage ? 'ready' : 'rejected-request') : (failure ?? 'loading')
      }
    >
      {row && shellMessage && readMessage && (
        <ConversationProvider
          hasInitMessages
          skipFetch
          context={{ agentId: 'agent-p08', threadId: null, topicId: 'topic-p08-consent' }}
          messages={row.consentToolMessages}
        >
          <div data-testid="out-of-scope-shell-confirmation">
            {renderIntervention(shellMessage)}
          </div>
          <div data-testid="out-of-scope-read-confirmation">{renderIntervention(readMessage)}</div>
        </ConversationProvider>
      )}
      {failure && <p role="alert">{failure}</p>}
    </section>
  );
};

const WorkspaceRuntimeProductHarness = () => (
  <I18nextProvider i18n={i18n}>
    <MotionProvider motion={m}>
      <MemoryRouter initialEntries={[`/agent/${AGENT_ID}/topic/topic-scratch`]}>
        <AntdApp>
          <main data-testid="workspace-runtime-product-ui">
            <StreamRecoveryHarness />
            <section data-testid="production-agent-sidebar">
              <SidebarBody />
            </section>

            <ModelCapabilityRows sectionTestId="model-capabilities" testIdPrefix="model-row-" />

            <BindOnceSection />
            <PathConsentSection />

            <section data-testid="compression-progress">
              <CompressionProgress />
            </section>

            <ContextBudgetCards />
          </main>
        </AntdApp>
      </MemoryRouter>
    </MotionProvider>
  </I18nextProvider>
);

const root = document.querySelector('#workspace-runtime-production-root');
if (!root) throw new Error('Workspace Runtime production E2E root is missing');

createRoot(root).render(<WorkspaceRuntimeProductHarness />);
