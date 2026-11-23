const workspaceScanMessages = {
  WORKSPACE_ACCESS_DENIED: 'Permission denied while reading the workspace.',
  WORKSPACE_DEVICE_OFFLINE: 'The device bound to this workspace is offline.',
  WORKSPACE_MACOS_FOLDER_ACCESS_DENIED: 'macOS denied access to a protected workspace folder.',
  WORKSPACE_ROOT_MISSING: 'The workspace folder is missing or is no longer a directory.',
  WORKSPACE_SCAN_TIMEOUT: 'The workspace scan timed out.',
} as const;

export type WorkspaceScanErrorCode = keyof typeof workspaceScanMessages;

export const isWorkspaceScanErrorCode = (value: unknown): value is WorkspaceScanErrorCode =>
  typeof value === 'string' && Object.hasOwn(workspaceScanMessages, value);

export class WorkspaceScanError extends Error {
  override name = 'WorkspaceScanError';

  constructor(
    readonly code: WorkspaceScanErrorCode,
    options?: ErrorOptions,
  ) {
    super(workspaceScanMessages[code], options);
  }
}
