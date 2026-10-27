export type UpdateChannel = 'stable' | 'canary';

export interface ReleaseNoteInfo {
  /**
   * The note.
   */
  note: string | null;
  /**
   * The version.
   */
  version: string;
}

export interface ProgressInfo {
  bytesPerSecond: number;
  percent: number;
  total: number;
  transferred: number;
}

export interface UpdateInfo {
  releaseDate: string;
  releaseNotes?: string | ReleaseNoteInfo[];
  version: string;
}

export type UpdaterStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'preparing-install'
  | 'downloaded'
  | 'latest'
  | 'error';

export type UpdaterInstallMode = 'open-dmg' | 'restart' | 'native-helper';

export type UpdaterErrorCode =
  | 'disk'
  | 'integrity'
  | 'install'
  | 'network'
  | 'signature'
  | 'unknown';

export type UpdaterDiagnosticTrigger = 'automatic' | 'manual';

export type UpdaterDiagnosticStepName =
  | 'artifact-selected'
  | 'artifact-verified'
  | 'check-completed'
  | 'check-started'
  | 'download-completed'
  | 'download-started'
  | 'failed'
  | 'manifest-requested'
  | 'manifest-received'
  | 'manifest-verified'
  | 'update-opened'
  | 'version-compared';

export type UpdaterDiagnosticStepStatus = 'error' | 'info' | 'success';

export interface UpdaterDiagnosticStep {
  at: string;
  detail?: string;
  name: UpdaterDiagnosticStepName;
  status: UpdaterDiagnosticStepStatus;
}

export interface UpdaterDiagnosticArtifact {
  arch: 'arm64' | 'x64';
  path: string;
  platform: 'darwin' | 'win32';
  size: number;
}

export interface UpdaterDiagnostic {
  arch: string;
  artifact?: UpdaterDiagnosticArtifact;
  channel: UpdateChannel;
  currentVersion: string;
  errorCode?: UpdaterErrorCode;
  errorMessage?: string;
  failedStep?: UpdaterDiagnosticStepName;
  finishedAt?: string;
  id: string;
  manifestHttpStatus?: number;
  manifestUrl: string;
  platform: string;
  schemaVersion: 1;
  stage: UpdaterStage;
  startedAt: string;
  steps: UpdaterDiagnosticStep[];
  targetVersion?: string;
  trigger: UpdaterDiagnosticTrigger;
}

export interface UpdaterRuntimeInfo {
  arch: string;
  buildChannel: string;
  currentVersion: string;
  platform: string;
  updateChannel: UpdateChannel;
}

export interface UpdaterState {
  autoDownloadEnabled: boolean;
  diagnostic?: UpdaterDiagnostic;
  errorCode?: UpdaterErrorCode;
  errorMessage?: string;
  installMode?: UpdaterInstallMode;
  manualDownloadAvailable?: boolean;
  progress?: ProgressInfo;
  runtime?: UpdaterRuntimeInfo;
  stage: UpdaterStage;
  updateInfo?: UpdateInfo;
}
