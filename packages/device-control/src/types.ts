import type { HeterogeneousSkillMaterializationMode, MaterializableSkill } from './cliSkills';

/**
 * Types for the device-control RPC surface. These mirror the shapes in
 * `@lobechat/electron-client-ipc` (desktop) and `@lobechat/types` (server), but
 * are re-declared here so this package stays a leaf with no UI / server
 * dependency. They are structurally compatible with their counterparts, so the
 * desktop wiring can pass its own IPC-typed implementations directly.
 */

// ─── Workspace scan ───

export interface ProjectSkillItem {
  description?: string;
  /** Total number of regular files under `skillDir` (recursive, including `SKILL.md`). */
  fileCount: number;
  /** Relative paths (within `skillDir`) of all regular files, sorted, capped. */
  files: string[];
  name: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Directory containing the SKILL.md. */
  skillDir: string;
  /** Source directory the skill was discovered in. */
  source: '.agents/skills' | '.claude/skills';
}

export interface InitWorkspaceParams {
  /** Working directory used to resolve the project root. */
  scope: string;
}

export interface WorkspaceInstructionsItem {
  content: string;
  source: 'AGENTS.md' | 'CLAUDE.md';
}

export interface InitWorkspaceResult {
  instructions: WorkspaceInstructionsItem[];
  root: string;
  skills: ProjectSkillItem[];
}

export interface ListProjectSkillsParams {
  /** Working directory used to resolve the project root. */
  scope: string;
}

export interface ListProjectSkillsResult {
  root: string;
  skills: ProjectSkillItem[];
  /** Source directory actually scanned (after fallback resolution). */
  source: ProjectSkillItem['source'] | null;
}

export interface StatPathResult {
  exists: boolean;
  isDirectory: boolean;
  repoType?: 'git' | 'github';
}

export interface ResolveRealPathParams {
  path: string;
}

export interface ResolveRealPathResult {
  path: string;
}

export interface EnsureScratchWorkspaceParams {
  /** Stable topic identifier; it is encoded into one safe host path segment. */
  topicId: string;
}

export interface EnsureScratchWorkspaceResult {
  root: string;
  topicSegment: string;
}

export interface CleanupScratchWorkspaceParams {
  /** Persisted workspace root used to resume or delete a pre-migration topic safely. */
  expectedRoot?: string;
  /** Stable topic identifier; callers cannot supply an arbitrary filesystem path. */
  topicId: string;
}

export interface CleanupScratchWorkspaceResult {
  removed: boolean;
  root: string;
  topicSegment: string;
}

export interface VerifySkillPathsParams {
  skillDir: string;
  workspaceRoot: string;
}

export interface VerifySkillPathsResult {
  skillDir: string;
  workspaceRoot: string;
}

export interface HeterogeneousAgentRunParams {
  agentType: string;
  cwd: string;
  env?: Record<string, string>;
  imageList?: Array<{ id?: string; url: string }>;
  jwt: string;
  operationId: string;
  prompt: string;
  resumeSessionId?: string;
  skillPolicy?: HeterogeneousSkillMaterializationMode;
  skills?: MaterializableSkill[];
  systemContext?: string;
  topicId: string;
}

export interface HeterogeneousAgentRunResult {
  reason?: string;
  status: 'accepted' | 'rejected';
}

// ─── File preview ───

export type LocalFilePreviewAccept = 'image';

export interface LocalFilePreviewUrlParams {
  accept?: LocalFilePreviewAccept;
  path: string;
  workingDirectory: string;
}

export interface LocalFilePreviewText {
  content: string;
  contentType: string;
  type: 'text';
}

export interface LocalFilePreviewImage {
  base64: string;
  contentType: string;
  type: 'image';
}

export interface LocalFilePreviewUnsupported {
  contentType: string;
  type: 'binary' | 'pdf' | 'video';
}

export type LocalFilePreview =
  | LocalFilePreviewImage
  | LocalFilePreviewText
  | LocalFilePreviewUnsupported;

export interface LocalFilePreviewResult {
  error?: string;
  preview?: LocalFilePreview;
  success: boolean;
}

// ─── Project file index ───

export interface ProjectFileIndexEntry {
  isDirectory: boolean;
  name: string;
  path: string;
  relativePath: string;
}

export interface ProjectFileIndexParams {
  /** Working directory used to resolve the project root. */
  scope?: string;
}

export interface ProjectFileIndexResult {
  entries: ProjectFileIndexEntry[];
  indexedAt: string;
  root: string;
  source: 'git' | 'glob';
  totalCount: number;
}

/**
 * The subset of platform hooks the workspace-scan helpers need. Kept narrow so
 * the desktop's local-IPC `WorkspaceCtr` can reuse `initWorkspace` /
 * `listProjectSkills` without supplying the file preview / index handlers.
 */
export interface WorkspaceScanDeps {
  /**
   * Approve a resolved project root for the host's file-preview protocol. Called
   * after workspace scans so a later click-through resolves. No-op on the CLI.
   */
  approveProjectRoot?: (root: string) => Promise<void>;
}

/**
 * Platform-specific handlers the device-control dispatcher delegates to. Git and
 * workspace-scan methods are implemented inside this package (over
 * `@lobechat/local-file-shell`); the handlers below differ per host:
 *
 * - Desktop injects implementations backed by its `localFileProtocolManager`
 *   (preview-protocol approval, secure file reads).
 * - The CLI uses the portable defaults exported from this package
 *   (`defaultGetLocalFilePreview`, `defaultGetProjectFileIndex`).
 */
export interface DeviceControlDeps extends WorkspaceScanDeps {
  /** Read a local file preview (host-gated on desktop; disk read on CLI). */
  getLocalFilePreview: (params: LocalFilePreviewUrlParams) => Promise<LocalFilePreviewResult>;
  /** Main-process evidence; never an agent-authored tool result. */
  getLocalScratchExecution?: (params: {
    operationId: string;
    toolCallId: string;
    topicId: string;
  }) => { root: string } | undefined;

  /** Build the project file index. */
  getProjectFileIndex: (params: ProjectFileIndexParams) => Promise<ProjectFileIndexResult>;
  /** Shared start/resume implementation used by the v2 RPC and legacy WS entry. */
  runHeterogeneousAgent?: (
    params: HeterogeneousAgentRunParams,
  ) => Promise<HeterogeneousAgentRunResult>;
  /** Explicit host root used only by ensureScratchWorkspace. */
  scratchRoot?: string;
  /** Previous host-managed roots accepted only when an exact persisted topic path is supplied. */
  legacyScratchRoots?: string[];
  skillCacheRoot?: string;
}
