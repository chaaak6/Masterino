export const acceptanceIds = [
  'AC-W01',
  'AC-W02',
  'AC-W03',
  'AC-W04',
  'AC-W05',
  'AC-W06',
  'AC-W07',
  'AC-W08',
  'AC-W09',
  'AC-W10',
  'AC-P01',
  'AC-P02',
  'AC-P03',
  'AC-P04',
  'AC-P05',
  'AC-P06',
  'AC-P07',
  'AC-P08',
  'AC-M01',
  'AC-M02',
  'AC-M03',
  'AC-M04',
  'AC-M05',
  'AC-M06',
  'AC-C01',
  'AC-C02',
  'AC-C03',
  'AC-C04',
  'AC-C05',
  'AC-C06',
  'AC-C07',
  'AC-C08',
  'AC-X01',
  'AC-X02',
] as const;

export type AcceptanceId = (typeof acceptanceIds)[number];

export type ContextBudgetFailCode =
  | 'NO_CANDIDATES'
  | 'RETRY_EXHAUSTED'
  | 'SUMMARY_FAILED'
  | 'TAIL_TOO_LARGE';

export type ContextErrorCardAction =
  | 'detach_attachments'
  | 'fork_topic'
  | 'retry_compression'
  | 'switch_compression_model'
  | 'switch_model'
  | 'truncate_tool_results';

export type RuntimeTarget = 'device' | 'local' | 'none' | 'sandbox';

export interface AcceptanceResultMap {
  'AC-C01': {
    events: string[];
    providerCallsBeforeCompression: number;
  };
  'AC-C02': {
    compressionCalls: number;
    effectiveWindowTokens: number;
    providerCalls: number;
  };
  'AC-C03': {
    code: string;
    providerCalls: number;
  };
  'AC-C04': {
    code: string;
    manualFeedback: string;
  };
  'AC-C05': {
    code: string;
    failedGroupId?: string;
    messagesAfter: string[];
    messagesBefore: string[];
  };
  'AC-C06': {
    chunkTokens: number[];
    summaryBudgetTokens: number;
  };
  'AC-C07': {
    failedProviderCalls: number;
    retryCode: string;
    retryProviderCalls: number;
    sameFingerprintProviderCalls: number;
    skippedProviderCalls: number;
  };
  'AC-C08': {
    cards: Array<{ actions: ContextErrorCardAction[]; code: ContextBudgetFailCode }>;
    diagnostics: string;
    secrets: string[];
  };
  'AC-M01': {
    chatIds: string[];
    defaultModelId?: string;
  };
  'AC-M02': {
    apiChatIds: string[];
    bridgeChatIds: string[];
  };
  'AC-M03': {
    developmentLabels: string[];
    productionLabels: string[];
  };
  'AC-M04': {
    afterNextSync: { image: string; maxOutput: number; text: string };
    driftFields: string[];
  };
  'AC-M05': {
    afterRefresh: Record<string, string>;
    beforeRefresh: Record<string, string>;
  };
  'AC-M06': {
    clientOperationId: string;
    clientSnapshot: string;
    serverOperationId: string;
    serverSnapshot: string;
  };
  'AC-P01': {
    execAllowed: boolean;
    modes: string[];
    rootPath?: string;
    scope?: string;
    writeAllowed: boolean;
  };
  'AC-P02': {
    consentBySource: Record<string, boolean>;
  };
  'AC-P03': {
    afterArchiveRoots: string[];
    afterRevokeRoots: string[];
    promptDuringGrant: string;
    reusedRoots: string[];
  };
  'AC-P04': {
    afterExpiryAllowed: boolean;
    beforeExpiryAllowed: boolean;
    otherDeviceAllowed: boolean;
  };
  'AC-P05': {
    sensitiveTraversalAllowed: boolean;
    symlinkToSensitiveAllowed: boolean;
  };
  'AC-P06': {
    ordinaryWriteAllowed: boolean;
    sensitiveReadCode: 'SCOPE_DENIED';
    sensitiveReadProviderCalls: number;
  };
  'AC-P07': {
    auditWarnings: Array<'MODEL_CWD_OVERRIDDEN'>;
    requestedCwd: string;
    spawnCwd: string;
  };
  'AC-P08': {
    consentNotice: string;
    displayedCommand: string;
    displayedCwd: string;
    riskNotice: string;
  };
  'AC-W01': {
    draftTarget: RuntimeTarget;
  };
  'AC-W02': {
    desktopDraftTarget: RuntimeTarget;
    persistedDesktopTarget: RuntimeTarget;
    webDraftTarget: RuntimeTarget;
  };
  'AC-W03': {
    devicePlanKind: string;
    deviceTarget: RuntimeTarget;
    localPlanKind: string;
    localTarget: RuntimeTarget;
  };
  'AC-W04': {
    projectWorkspaceRowsAfter: number;
    projectWorkspaceRowsBefore: number;
    scratchDirectoriesAfter: string[];
    scratchDirectoriesBefore: string[];
  };
  'AC-W05': {
    recentTopicIds: string[];
    taskListCountAfter: number;
    taskListCountBefore: number;
    taskTopicRowsAfter: number;
    taskTopicRowsBefore: number;
    taskUiLabelsAfter: string[];
    taskUiLabelsBefore: string[];
    topLevelTopicVisible: boolean;
  };
  'AC-W06': {
    recentTopicIds: string[];
    workspaceGroups: Record<string, string[]>;
  };
  'AC-W07': {
    directReadScratchCount: number;
    recentTopicIds: string[];
    scratchCreateCalls: number;
    scratchIds: string[];
    snapshotWorkspaceIds: string[];
    temporaryMarkerVisible: boolean;
  };
  'AC-W08': {
    actionLabel: string;
    allowed: boolean;
    cwdAfter: string;
    cwdBefore: string;
  };
  'AC-W09': {
    agentDefaultAfter?: string;
    agentDefaultBefore?: string;
    bindingBySource: Record<string, boolean>;
    createdTopicWorkspaceIds: string[];
  };
  'AC-W10': {
    normalizedResumeIdentity: string;
    preBindCode: string;
    persistedIdentity: string;
  };
  'AC-X01': {
    accessOperationId: string;
    budgetOperationId: string;
    cwdOperationId: string;
    modelOperationId: string;
  };
  'AC-X02': {
    matrix: Array<{
      client: 'new' | 'old';
      device: 'new' | 'old';
      hardValidated: boolean;
      passed: boolean;
      server: 'new' | 'old';
    }>;
  };
}

export type WorkspaceRuntimeAcceptanceAdapter = {
  readonly [Id in AcceptanceId]: () => Promise<AcceptanceResultMap[Id]>;
};

export class MissingAcceptanceSeamError extends Error {
  readonly code = 'MISSING_ACCEPTANCE_SEAM';

  constructor(
    readonly acceptanceId: AcceptanceId,
    readonly seam: string,
  ) {
    super(`${acceptanceId}: MISSING_ACCEPTANCE_SEAM (${seam})`);
    this.name = 'MissingAcceptanceSeamError';
  }
}

export const missingAcceptanceSeam = <Id extends AcceptanceId>(
  acceptanceId: Id,
  seam: string,
): (() => Promise<AcceptanceResultMap[Id]>) => {
  return async () => {
    throw new MissingAcceptanceSeamError(acceptanceId, seam);
  };
};
