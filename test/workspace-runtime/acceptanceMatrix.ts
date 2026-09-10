import type { AcceptanceId } from './contracts';

export const frozenArgv = {
  diffCheck: ['git', 'diff', '--check'],
  electron: [
    'pnpm',
    'exec',
    'playwright',
    'test',
    '--config=e2e/electron/playwright.config.mjs',
    '--list',
    'e2e/electron/workspace-runtime.spec.ts',
  ],
  typeCheck: ['bun', 'run', 'type-check'],
  vitest: ['bunx', 'vitest', 'run', '--silent=passed-only', 'test/workspace-runtime'],
} as const;

export type AcceptanceCommand = 'electron' | 'vitest';

export interface AcceptanceMatrixRow {
  command: AcceptanceCommand;
  failCondition: string;
  fixture: string;
  observable: string;
  testId: AcceptanceId;
}

export const acceptanceMatrix = [
  {
    command: 'vitest',
    failCondition: 'A new desktop draft resolves to sandbox or any target other than local.',
    fixture: 'New desktop topic draft with no stored target.',
    observable: 'Resolved draft target is local.',
    testId: 'AC-W01',
  },
  {
    command: 'vitest',
    failCondition:
      'Web sandbox leaks into desktop defaults, or a persisted desktop sandbox is ignored.',
    fixture: 'Web sandbox preference, fresh desktop draft, and persisted desktop sandbox snapshot.',
    observable: 'Web=sandbox, fresh desktop=local, persisted desktop=sandbox.',
    testId: 'AC-W02',
  },
  {
    command: 'vitest',
    failCondition: 'Unavailable local/device intent becomes sandbox/cloud or appears routed.',
    fixture: 'Offline bound local snapshot and offline explicit device target.',
    observable: 'Both plans are device-unrouted and retain local/device intent.',
    testId: 'AC-W03',
  },
  {
    command: 'electron',
    failCondition: 'Five pure-chat turns create a project_workspaces row or scratch directory.',
    fixture: 'Unbound desktop topic, five user/assistant pure-chat turns.',
    observable: 'Workspace row count and scratch filesystem snapshot remain unchanged.',
    testId: 'AC-W04',
  },
  {
    command: 'electron',
    failCondition:
      'Topic nav disappears, unbound topic leaves Recent, or any Task DB/UI count changes.',
    fixture: 'Unbound topic alongside existing TaskList and tasks/task_topics records.',
    observable:
      'Top-level Topic and Recent update only; Task data and T-n labels are byte-for-byte stable.',
    testId: 'AC-W05',
  },
  {
    command: 'electron',
    failCondition: 'Bound topics duplicate in Recent or a workspace cannot list multiple topics.',
    fixture: 'Two topics bound to the same formal workspace.',
    observable: 'Both occur only under that Workspace group.',
    testId: 'AC-W06',
  },
  {
    command: 'electron',
    failCondition:
      'Read consent creates scratch, concurrent lazy init creates more than one, or snapshot/marker is absent.',
    fixture: 'Absolute structured read followed by concurrent first default-cwd device operations.',
    observable:
      'No scratch for read; exactly one persisted scratch and stable snapshot for device tools.',
    testId: 'AC-W07',
  },
  {
    command: 'electron',
    failCondition:
      'A scratch topic is rebound, cwd changes, or the new-project-topic action is missing.',
    fixture: 'Scratch-bound topic selecting a formal project directory.',
    observable: 'Bind is rejected, cwd is stable, and explicit new topic action is offered.',
    testId: 'AC-W08',
  },
  {
    command: 'electron',
    failCondition:
      'Explicit creation mutates agent default, or quote/code/attachment silently binds.',
    fixture:
      'Workspace + action, confirmed direct directory, quote, code block, and attachment path.',
    observable: 'Only explicit sources create workspace-topics; global agent default is unchanged.',
    testId: 'AC-W09',
  },
  {
    command: 'electron',
    failCondition:
      'Unbound heterogeneous agent sends, or resume uses a noncanonical workspace identity.',
    fixture: 'Heterogeneous agent before bind, then resume after formal binding.',
    observable: 'First send is blocked; resumed operation uses normalized persisted identity.',
    testId: 'AC-W10',
  },
  {
    command: 'vitest',
    failCondition: 'Consent comes from a non-latest/non-direct source or authorizes write/exec.',
    fixture: 'Latest direct plain user text naming an absolute path with a structured read call.',
    observable: 'One operation-scoped read root only.',
    testId: 'AC-P01',
  },
  {
    command: 'vitest',
    failCondition:
      'Any quote, code, attachment, refer-topic, bot/task/cron/eval/headless source grants consent.',
    fixture: 'Path-injection source matrix.',
    observable: 'Every negative source produces no automatic consent.',
    testId: 'AC-P02',
  },
  {
    command: 'vitest',
    failCondition: 'Topic grant is not reused/prompted, or remains after revoke/archive.',
    fixture: 'Read/write topic grant lifecycle.',
    observable: 'Authorized roots enter runtime prompt until revoke/archive, then disappear.',
    testId: 'AC-P03',
  },
  {
    command: 'vitest',
    failCondition: 'Exec grant survives one hour or crosses device scope.',
    fixture: 'Clock-controlled exec grant on device A and same path on device B.',
    observable: 'Valid before expiry only on device A.',
    testId: 'AC-P04',
  },
  {
    command: 'vitest',
    failCondition: 'Traversal or a symlink resolving into a sensitive root is allowed.',
    fixture: '~/grant/../.ssh and grant-child symlink to sensitive directory.',
    observable: 'Device-side realpath rejects both.',
    testId: 'AC-P05',
  },
  {
    command: 'vitest',
    failCondition:
      'Auto-run permits a sensitive read, or an ordinary external write is blocked before provider execution.',
    fixture: 'Sensitive read and ordinary write outside roots under auto-run.',
    observable:
      'Sensitive read returns SCOPE_DENIED with zero provider calls; ordinary write is prepared.',
    testId: 'AC-P06',
  },
  {
    command: 'vitest',
    failCondition:
      'Model-supplied cwd reaches spawn, override warning is absent, or warning leaks requested cwd.',
    fixture: 'runCommand.cwd points outside the primary workspace.',
    observable:
      'Spawn cwd is primary cwd and audit contains only stable MODEL_CWD_OVERRIDDEN warning data.',
    testId: 'AC-P07',
  },
  {
    command: 'electron',
    failCondition: 'UI implies isolation or hides full cwd/out-of-scope shell risk.',
    fixture: 'Consent dialog and shell confirmation for an out-of-scope path.',
    observable: 'Consent/audit-not-isolation wording plus full cwd, command, and path risk.',
    testId: 'AC-P08',
  },
  {
    command: 'vitest',
    failCondition: 'Rerank/embedding model enters chat list or becomes default.',
    fixture: 'Bridge payload containing two rerankers, one embedding model, and one chat model.',
    observable: 'Only the chat model is selectable/defaultable.',
    testId: 'AC-M01',
  },
  {
    command: 'vitest',
    failCondition: 'DB/bridge and API synchronization paths classify differently.',
    fixture: 'Same mixed-kind catalog through both sync entry points.',
    observable: 'Both paths produce identical eligible chat ids.',
    testId: 'AC-M02',
  },
  {
    command: 'electron',
    failCondition: 'A row lacks supported/text-only/unknown or label changes with dev mode.',
    fixture: 'Supported, explicitly text-only, and unknown chat entries in dev and production.',
    observable: 'Exactly the same three accessibility labels in both modes.',
    testId: 'AC-M03',
  },
  {
    command: 'vitest',
    failCondition:
      'Exact manual deny is delayed, unrelated fields are overwritten, or conflict has no drift.',
    fixture: 'Observed entry plus exact deny and one-field manual capability override.',
    observable: 'Next sync applies field-scoped precedence and records drift.',
    testId: 'AC-M04',
  },
  {
    command: 'vitest',
    failCondition: 'Refresh clears observed/manual metadata.',
    fixture: 'Catalog row carrying observed and manual evidence through refresh.',
    observable: 'Evidence metadata is preserved transactionally.',
    testId: 'AC-M05',
  },
  {
    command: 'vitest',
    failCondition: 'Client and server use different snapshots or operation ids.',
    fixture: 'One operation captured while catalog refreshes.',
    observable: 'Both runtime sides retain the same frozen model snapshot.',
    testId: 'AC-M06',
  },
  {
    command: 'vitest',
    failCondition: 'Provider is called before final injected context is compressed.',
    fixture: 'Post-injection prompt above effective threshold.',
    observable: 'Compression precedes the first provider request.',
    testId: 'AC-C01',
  },
  {
    command: 'vitest',
    failCondition: 'Observed 32k recovery does not compress or makes more than one retry.',
    fixture: 'Catalog 128k, provider reports actual 32k on first request.',
    observable: 'Observed window becomes 32k; one compression and one retry.',
    testId: 'AC-C02',
  },
  {
    command: 'vitest',
    failCondition: 'Oversized tail returns another code or calls provider.',
    fixture: 'Single 200k latest user text/attachment with no compressible history.',
    observable: 'TAIL_TOO_LARGE and zero provider calls.',
    testId: 'AC-C03',
  },
  {
    command: 'electron',
    failCondition: 'No-candidate compression is silent or reports another code.',
    fixture: 'Manual compression with no candidates.',
    observable: 'NO_CANDIDATES plus visible user feedback.',
    testId: 'AC-C04',
  },
  {
    command: 'vitest',
    failCondition: 'Failed summary replaces messages or cannot be traced as a group.',
    fixture: 'Summary-model failure inside a candidate group.',
    observable: 'SUMMARY_FAILED, unchanged originals, traceable failed group.',
    testId: 'AC-C05',
  },
  {
    command: 'vitest',
    failCondition: 'Any summary request exceeds the summary model budget.',
    fixture: 'History larger than the summary model context window.',
    observable: 'Bounded chunks, each at or below its own budget.',
    testId: 'AC-C06',
  },
  {
    command: 'vitest',
    failCondition:
      'Skipped/failed/same fingerprint calls LLM or second upstream overflow retries again.',
    fixture: 'Compression outcomes and repeated provider-overflow matrix.',
    observable: 'Zero forbidden calls and terminal RETRY_EXHAUSTED.',
    testId: 'AC-C07',
  },
  {
    command: 'electron',
    failCondition:
      'SUMMARY_FAILED lacks retry/model-switch actions, another code enables retry, or diagnostics leak secrets.',
    fixture: 'All context fail codes with canary text and attachment names.',
    observable:
      'SUMMARY_FAILED can retry/switch compression model; NO_CANDIDATES and RETRY_EXHAUSTED cannot retry; diagnostics are redacted.',
    testId: 'AC-C08',
  },
  {
    command: 'vitest',
    failCondition: 'cwd/access/model/budget traces cannot join on one operation id.',
    fixture: 'P1/P2/P3/P4 records for a single operation.',
    observable: 'All records carry the same operation id.',
    testId: 'AC-X01',
  },
  {
    command: 'electron',
    failCondition:
      'Any new/old client-server-device cell fails or old device is marked hard-validated.',
    fixture: 'Complete 2x2x2 compatibility grid.',
    observable: 'Eight passing cells; every old-device cell has hardValidated=false.',
    testId: 'AC-X02',
  },
] as const satisfies readonly AcceptanceMatrixRow[];
