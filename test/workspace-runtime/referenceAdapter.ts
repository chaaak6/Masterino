import type { AcceptanceResultMap, WorkspaceRuntimeAcceptanceAdapter } from './contracts';

const result = <Id extends keyof AcceptanceResultMap>(value: AcceptanceResultMap[Id]) => {
  return async (): Promise<AcceptanceResultMap[Id]> => structuredClone(value);
};

const compatibilityMatrix = (['old', 'new'] as const).flatMap((server) =>
  (['old', 'new'] as const).flatMap((device) =>
    (['old', 'new'] as const).map((client) => ({
      client,
      device,
      hardValidated: client === 'new' && server === 'new' && device === 'new',
      passed: true,
      server,
    })),
  ),
);

/**
 * Executable oracle for the acceptance harness. It models only approved observable behavior and
 * deliberately imports no production implementation. Production conformance uses a separate
 * adapter, so this oracle cannot make a production assertion pass.
 */
export const referenceWorkspaceRuntimeAdapter: WorkspaceRuntimeAcceptanceAdapter = {
  'AC-C01': result({
    events: ['estimate-final-context', 'compress', 'provider-request'],
    providerCallsBeforeCompression: 0,
  }),
  'AC-C02': result({ compressionCalls: 1, effectiveWindowTokens: 32_000, providerCalls: 2 }),
  'AC-C03': result({ code: 'TAIL_TOO_LARGE', providerCalls: 0 }),
  'AC-C04': result({
    code: 'NO_CANDIDATES',
    manualFeedback: 'No messages are available to compress.',
  }),
  'AC-C05': result({
    code: 'SUMMARY_FAILED',
    failedGroupId: 'summary-group-1',
    messagesAfter: ['old-1', 'old-2', 'latest'],
    messagesBefore: ['old-1', 'old-2', 'latest'],
  }),
  'AC-C06': result({ chunkTokens: [7_900, 7_950, 3_100], summaryBudgetTokens: 8_000 }),
  'AC-C07': result({
    failedProviderCalls: 0,
    retryCode: 'RETRY_EXHAUSTED',
    retryProviderCalls: 2,
    sameFingerprintProviderCalls: 0,
    skippedProviderCalls: 0,
  }),
  'AC-C08': result({
    cards: [
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
    ],
    diagnostics:
      '{"operationId":"operation-1","code":"TAIL_TOO_LARGE","offending":[{"source":"attachment","estimatedTokens":200000}]}',
    secrets: ['PRIVATE_MESSAGE_CANARY', 'payroll-secret.pdf'],
  }),
  'AC-M01': result({ chatIds: ['qwen3-vl-plus'], defaultModelId: 'qwen3-vl-plus' }),
  'AC-M02': result({ apiChatIds: ['qwen3-vl-plus'], bridgeChatIds: ['qwen3-vl-plus'] }),
  'AC-M03': result({
    developmentLabels: ['supported', 'text-only', 'unknown'],
    productionLabels: ['supported', 'text-only', 'unknown'],
  }),
  'AC-M04': result({
    afterNextSync: { image: 'unsupported', maxOutput: 8192, text: 'supported' },
    driftFields: ['image'],
  }),
  'AC-M05': result({
    afterRefresh: {
      contextWindowSource: 'observed',
      image: 'unsupported',
      imageSource: 'manual',
    },
    beforeRefresh: {
      contextWindowSource: 'observed',
      image: 'unsupported',
      imageSource: 'manual',
    },
  }),
  'AC-M06': result({
    clientOperationId: 'operation-1',
    clientSnapshot: 'snapshot-v1',
    serverOperationId: 'operation-1',
    serverSnapshot: 'snapshot-v1',
  }),
  'AC-P01': result({
    execAllowed: false,
    modes: ['read'],
    rootPath: '/outside/docs',
    scope: 'operation',
    writeAllowed: false,
  }),
  'AC-P02': result({
    consentBySource: {
      attachment: false,
      bot: false,
      codeBlock: false,
      cron: false,
      eval: false,
      headless: false,
      quote: false,
      referTopic: false,
      task: false,
    },
  }),
  'AC-P03': result({
    afterArchiveRoots: [],
    afterRevokeRoots: [],
    promptDuringGrant: 'Authorized read/write root: /outside/docs',
    reusedRoots: ['/outside/docs'],
  }),
  'AC-P04': result({
    afterExpiryAllowed: false,
    beforeExpiryAllowed: true,
    otherDeviceAllowed: false,
  }),
  'AC-P05': result({
    sensitiveTraversalAllowed: false,
    symlinkToSensitiveAllowed: false,
  }),
  'AC-P06': result({
    ordinaryWriteAllowed: true,
    sensitiveReadCode: 'SCOPE_DENIED',
    sensitiveReadProviderCalls: 0,
  }),
  'AC-P07': result({
    auditWarnings: ['MODEL_CWD_OVERRIDDEN'],
    requestedCwd: '/tmp/injected',
    spawnCwd: '/code/masterino',
  }),
  'AC-P08': result({
    consentNotice: 'Consent enables access and audit logging. It is not filesystem isolation.',
    displayedCommand: 'cat /outside/payroll.csv',
    displayedCwd: '/code/masterino',
    riskNotice: 'This shell command reaches /outside/payroll.csv outside the current workspace.',
  }),
  'AC-W01': result({ draftTarget: 'local' }),
  'AC-W02': result({
    desktopDraftTarget: 'local',
    persistedDesktopTarget: 'sandbox',
    webDraftTarget: 'sandbox',
  }),
  'AC-W03': result({
    devicePlanKind: 'device-unrouted',
    deviceTarget: 'device',
    localPlanKind: 'device-unrouted',
    localTarget: 'local',
  }),
  'AC-W04': result({
    projectWorkspaceRowsAfter: 0,
    projectWorkspaceRowsBefore: 0,
    scratchDirectoriesAfter: [],
    scratchDirectoriesBefore: [],
  }),
  'AC-W05': result({
    recentTopicIds: ['topic-unbound'],
    taskListCountAfter: 2,
    taskListCountBefore: 2,
    taskTopicRowsAfter: 3,
    taskTopicRowsBefore: 3,
    taskUiLabelsAfter: ['T-1', 'T-2'],
    taskUiLabelsBefore: ['T-1', 'T-2'],
    topLevelTopicVisible: true,
  }),
  'AC-W06': result({
    recentTopicIds: [],
    workspaceGroups: { 'workspace-a': ['topic-a', 'topic-b'] },
  }),
  'AC-W07': result({
    directReadScratchCount: 0,
    recentTopicIds: ['topic-unbound'],
    scratchCreateCalls: 1,
    scratchIds: ['scratch-a'],
    snapshotWorkspaceIds: ['scratch-a', 'scratch-a'],
    temporaryMarkerVisible: true,
  }),
  'AC-W08': result({
    actionLabel: 'Create new project topic',
    allowed: false,
    cwdAfter: '/tmp/masterino/scratch-a',
    cwdBefore: '/tmp/masterino/scratch-a',
  }),
  'AC-W09': result({
    agentDefaultAfter: '/agent/default',
    agentDefaultBefore: '/agent/default',
    bindingBySource: {
      attachment: false,
      codeBlock: false,
      confirmedDirectory: true,
      quote: false,
      workspacePlus: true,
    },
    createdTopicWorkspaceIds: ['workspace-a', 'workspace-a'],
  }),
  'AC-W10': result({
    normalizedResumeIdentity: 'id:workspace-a:device:device-a:/code/masterino',
    persistedIdentity: 'id:workspace-a:device:device-a:/code/masterino',
    preBindCode: 'WORKSPACE_REQUIRED',
  }),
  'AC-X01': result({
    accessOperationId: 'operation-1',
    budgetOperationId: 'operation-1',
    cwdOperationId: 'operation-1',
    modelOperationId: 'operation-1',
  }),
  'AC-X02': result({ matrix: compatibilityMatrix }),
};
