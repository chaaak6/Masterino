/**
 * Desktop isolated workspace stub.
 *
 * `@lobechat/types` is only consumed via `import type` in desktop code and in
 * the `@lobechat/const` entrypoints it reaches (currently `desktopGlobalShortcuts`).
 * Those specifiers are erased at build time, so this package has no runtime
 * exports — we only need to surface the types that reach the desktop tsgo
 * project. Keep these in sync with `packages/types/src/hotkey.ts`.
 */

export type DesktopHotkeyId = 'openSettings' | 'quickChat' | 'quickComposer' | 'showApp';

export interface DesktopHotkeyItem {
  id: DesktopHotkeyId;
  keys: string;
  nonEditable?: boolean;
}

export type DesktopHotkeyConfig = Record<DesktopHotkeyId, string>;

/**
 * Mirror of `@lobechat/types`' `BuiltinServerRuntimeOutput`. Reached by
 * `@lobechat/tool-runtime` (the runtime the gateway controller reuses) via
 * `import type`, so only the shape is needed. Keep in sync with
 * `packages/types/src/tool/builtin.ts`.
 */
export interface BuiltinServerRuntimeOutput {
  content: string;
  error?: unknown;
  state?: unknown;
  success: boolean;
}

/**
 * Desktop-isolated mirrors of the execution-context transport types consumed
 * by the gateway client packages. Keep these aligned with
 * `packages/types/src/executionContext/index.ts`; this stub supplies types only
 * and has no runtime exports.
 */
export type PathAccessMode = 'exec' | 'read' | 'write';

export interface ExecutionAccessRoot {
  deviceId?: string;
  expiresAt?: string;
  grantId?: string;
  modes: PathAccessMode[];
  operationId?: string;
  rootPath: string;
  scope: 'operation' | 'primary' | 'topic';
  source: 'direct-user-message' | 'user-approval' | 'workspace';
  target?: 'file' | 'directory';
  topicId?: string;
}

export interface ToolCallExecutionContext {
  accessRoots?: ExecutionAccessRoot[];
  cwd?: string;
  env?: Record<string, string>;
  envFiles?: string[];
  envRef?: { agentId: string; topicId?: string; workspaceId?: string };
  workspaceKind?: 'device' | 'sandbox' | 'scratch';
  workspaceRootPath?: string;
}
