import type { DeviceExecutionTarget } from '../agent/agencyConfig';
import type { TopicExecutionSnapshot, WorkspaceKind, WorkspaceRef } from '../projectWorkspace';

export type PathAccessMode = 'exec' | 'read' | 'write';

/** Runtime-authored evidence attached to an out-of-scope filesystem intervention. */
export interface WorkspacePathConsentRequest {
  actualCwd: string;
  deviceId: string;
  modes: PathAccessMode[];
  operationId: string;
  primaryCwd: string;
  /** Device-canonical path that triggered the intervention. */
  requestedPath: string;
  topicId: string;
  version: 1;
  warnings?: Array<{ code: 'MODEL_CWD_OVERRIDDEN'; overridden: true }>;
}

/** User decision transported when an approved tool is resumed in a new operation. */
export interface OperationPathConsentApproval {
  deviceId: string;
  modes: PathAccessMode[];
  /** Runtime-authored lexical path, used to bind this decision to the pending request. */
  requestedPath: string;
  /** Device-canonical root returned by the consent coordinator. */
  rootPath: string;
  scope: 'operation';
  /** Operation that authored the matching intervention evidence. */
  sourceOperationId: string;
  topicId: string;
  version: 1;
}

export interface WorkspaceAccessGrant {
  createdAt: string;
  deviceId: string;
  expiresAt?: string;
  id: string;
  lastUsedAt?: string;
  modes: PathAccessMode[];
  requestedVia: { messageId?: string; reason?: string; toolCallId?: string };
  revokedAt?: string;
  /** Device-realpathed, normalized absolute path. */
  rootPath: string;
  /** Persisted grants are topic-scoped; operation consent is never stored here. */
  scope: 'topic';
  topicId: string;
  userId: string;
}

export interface ExecutionAccessRoot {
  /** Required transport evidence for a persisted topic grant. */
  deviceId?: string;
  expiresAt?: string;
  grantId?: string;
  modes: PathAccessMode[];
  /** Required transport evidence for an operation-scoped consent root. */
  operationId?: string;
  /** Device-realpathed, normalized absolute path. */
  rootPath: string;
  scope: 'operation' | 'primary' | 'topic';
  source: 'direct-user-message' | 'user-approval' | 'workspace';
  /** Omitted legacy records remain directory grants. */
  target?: 'file' | 'directory';
  /** Required transport evidence for a persisted topic grant. */
  topicId?: string;
}

export type ExecutionEnvLayer = 'agent' | 'call' | 'host' | 'topic' | 'user' | 'workspace';

/** Server/device-only resolved values. Browser-facing copies use ExecutionEnvSummary. */
export interface ExecutionEnv {
  secretKeys: string[];
  sources: Record<string, ExecutionEnvLayer>;
  values: Record<string, string>;
}

/** Client-safe projection: names only, never values. */
export interface ExecutionEnvSummary {
  keys: string[];
  secretKeys: string[];
}

export interface ExecutionEnvRef {
  agentId: string;
  topicId?: string;
  workspaceId?: string;
}

export interface ResolveExecutionEnvRequest {
  agentId: string;
  operationId: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

/** IO boundary implemented by the environment lane; this contract performs no merge or storage. */
export interface ExecutionEnvAdapter {
  resolve: (request: ResolveExecutionEnvRequest) => Promise<ExecutionEnv>;
  summarize: (env: ExecutionEnv) => ExecutionEnvSummary;
}

export type ExecutionPlanUnroutedReason =
  | 'ambiguous-online-devices'
  | 'bound-device-offline'
  | 'no-bound-device'
  | 'no-online-device';

export type ExecutionPlan = { target: DeviceExecutionTarget } & (
  | { deviceId: string; kind: 'device' }
  | { kind: 'device-unrouted'; reason: ExecutionPlanUnroutedReason }
  | { kind: 'none' }
  | { kind: 'sandbox' }
);

export type ExecutionContextUnresolvedReason = 'device-unrouted' | 'no-workspace' | 'target-none';

export type ExecutionApprovalMode = 'allow-list' | 'auto-run' | 'headless' | 'manual';

/** The single, operation-scoped execution result consumed by all execution channels. */
export interface ExecutionContext {
  accessRoots?: ExecutionAccessRoot[];
  /** Frozen user approval policy consumed by the final device boundary. */
  approvalMode?: ExecutionApprovalMode;
  cwd?: string;
  /** Server/device-only. Never serialize values to a browser-facing response. */
  env?: ExecutionEnv;
  /** Device-side workspace-relative dotenv files, frozen with the operation. */
  envFiles?: string[];
  envSummary?: ExecutionEnvSummary;
  /** Correlates cwd/access/model/budget traces without copying their payloads. */
  operationId?: string;
  plan: ExecutionPlan;
  snapshot?: TopicExecutionSnapshot;
  unresolvedReason?: ExecutionContextUnresolvedReason;
  version: 1;
  workspace?: WorkspaceRef;
}

/** Optional transport subset. Old devices ignore fields they do not understand. */
export interface ToolCallExecutionContext {
  accessRoots?: ExecutionAccessRoot[];
  /** User approval policy for this operation; old devices safely ignore it. */
  approvalMode?: ExecutionApprovalMode;
  cwd?: string;
  /** Gateway/server channel only. Renderer-originated calls use envRef. */
  env?: Record<string, string>;
  envFiles?: string[];
  envRef?: ExecutionEnvRef;
  workspaceKind?: WorkspaceKind;
  workspaceRootPath?: string;
}

export type ExecutionContextErrorCode =
  | 'DEVICE_UNROUTED'
  | 'LOCAL_TARGET_UNAVAILABLE'
  | 'TARGET_NONE'
  | 'WORKSPACE_ALREADY_BOUND'
  | 'WORKSPACE_REQUIRED';

export interface ExecutionContextError {
  code: ExecutionContextErrorCode;
  message: string;
  unroutedReason?: ExecutionPlanUnroutedReason;
}
