import type {
  EditLocalFileParams,
  GetCommandOutputParams,
  GlobFilesParams,
  GrepContentParams,
  KillCommandParams,
  ListLocalFileParams,
  LocalReadFileParams,
  LocalReadFilesParams,
  LocalSearchFilesParams,
  MoveLocalFilesParams,
  RunCommandParams,
  WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';
import { LocalSystemExecutionRuntime } from '@lobechat/tool-runtime';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { localFileService } from '@/services/electron/localFileService';

import { LocalSystemIdentifier } from '../../types';
import { isEscapingPathPattern, resolveArgsWithScope } from '../../utils/path';

const LocalSystemApiEnum = {
  editFile: 'editFile' as const,
  getCommandOutput: 'getCommandOutput' as const,
  globFiles: 'globFiles' as const,
  grepContent: 'grepContent' as const,
  killCommand: 'killCommand' as const,
  listFiles: 'listFiles' as const,
  moveFiles: 'moveFiles' as const,
  batchOfficeDocument: 'batchOfficeDocument' as const,
  mergeOfficeTemplate: 'mergeOfficeTemplate' as const,
  validateOfficeDocument: 'validateOfficeDocument' as const,
  createOfficeDocument: 'createOfficeDocument' as const,
  inspectOfficeDocument: 'inspectOfficeDocument' as const,
  readOfficeDocument: 'readOfficeDocument' as const,
  readFile: 'readFile' as const,
  readFiles: 'readFiles' as const,
  runCommand: 'runCommand' as const,
  searchFiles: 'searchFiles' as const,
  writeFile: 'writeFile' as const,
};

/**
 * Local System Tool Executor
 *
 * Delegates standard computer operations to LocalSystemExecutionRuntime (extends ComputerRuntime).
 * Handles scope resolution for paths before delegating.
 */
class LocalSystemExecutor extends BaseExecutor<typeof LocalSystemApiEnum> {
  readonly identifier = LocalSystemIdentifier;
  protected readonly apiEnum = LocalSystemApiEnum;

  batchOfficeDocument = async (args: Record<string, unknown>, ctx?: BuiltinToolContext) =>
    (await this.executeOnDesktopBoundary('batchOfficeDocument', args, ctx)) ?? {
      content: 'Office tools require a bound device execution context',
      success: false,
    };
  mergeOfficeTemplate = async (args: Record<string, unknown>, ctx?: BuiltinToolContext) =>
    (await this.executeOnDesktopBoundary('mergeOfficeTemplate', args, ctx)) ?? {
      content: 'Office tools require a bound device execution context',
      success: false,
    };
  validateOfficeDocument = async (args: Record<string, unknown>, ctx?: BuiltinToolContext) =>
    (await this.executeOnDesktopBoundary('validateOfficeDocument', args, ctx)) ?? {
      content: 'Office tools require a bound device execution context',
      success: false,
    };

  createOfficeDocument = async (args: Record<string, unknown>, ctx?: BuiltinToolContext) =>
    (await this.executeOnDesktopBoundary('createOfficeDocument', args, ctx)) ?? {
      content: 'Office tools require a bound device execution context',
      success: false,
    };

  inspectOfficeDocument = async (args: Record<string, unknown>, ctx?: BuiltinToolContext) =>
    (await this.executeOnDesktopBoundary('inspectOfficeDocument', args, ctx)) ?? {
      content: 'Office tools require a bound device execution context',
      success: false,
    };

  readOfficeDocument = async (args: Record<string, unknown>, ctx?: BuiltinToolContext) =>
    (await this.executeOnDesktopBoundary('readOfficeDocument', args, ctx)) ?? {
      content: 'Office tools require a bound device execution context',
      success: false,
    };

  private runtime = new LocalSystemExecutionRuntime(localFileService);

  private async executeOnDesktopBoundary(
    apiName: string,
    args: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult | undefined> {
    const executionContext = ctx?.executionContext;
    if (!executionContext) {
      if (args.attachmentId !== undefined)
        return {
          success: false,
          content: 'Attachment tools require a bound device execution context',
        };
      return;
    }
    if (executionContext.plan.kind !== 'device' || executionContext.plan.target !== 'local') {
      return {
        content: 'DEVICE_UNROUTED',
        error: {
          message: 'Remote-device execution cannot fall back to the local desktop runtime.',
          type: 'PluginServerError',
        },
        success: false,
      };
    }

    const operationId = executionContext.operationId ?? ctx.operationId;
    const topicId = ctx.topicId ?? undefined;
    if (!operationId || !topicId || !ctx.agentId || !ctx.toolCallId)
      return this.workspaceRequired({
        messageId: ctx.messageId,
        operationId: ctx.operationId,
      });

    const request = {
      apiName,
      args,
      executionContext: {
        accessRoots: executionContext.accessRoots,
        approvalMode: executionContext.approvalMode,
        cwd: executionContext.cwd,
        envFiles: executionContext.envFiles,
        envRef: {
          agentId: ctx.agentId,
          topicId,
          workspaceId: executionContext.workspace?.id,
        },
        workspaceKind: executionContext.workspace?.kind,
        workspaceRootPath: executionContext.workspace?.rootPath,
      },
      trace: {
        deviceId: executionContext.plan.deviceId,
        operationId,
        toolCallId: ctx.toolCallId,
        topicId,
      },
    };
    const output = ['inspectOfficeDocument', 'readOfficeDocument'].includes(apiName)
      ? await gatewayConnectionService.executeLocalToolCall(request, { signal: ctx.signal })
      : await gatewayConnectionService.executeLocalToolCall(request);

    return this.toResult(output);
  }

  private workspaceRequired(ctx?: BuiltinToolContext): BuiltinToolResult | undefined {
    if (!ctx || ctx.workingDirectory || ctx.executionContext) return;
    return {
      content: 'WORKSPACE_REQUIRED',
      error: { message: 'WORKSPACE_REQUIRED', type: 'PluginServerError' },
      success: false,
    };
  }

  /**
   * Convert BuiltinServerRuntimeOutput to BuiltinToolResult.
   *
   * Single funnel for every executor return — keep it strict:
   * - never propagate an undefined `content` (would collapse downstream into
   *   `''` and leave the Debug "Response" pane blank while pluginState was
   *   still saved — see globFiles regression);
   * - always preserve `state` when the runtime produced one, regardless of
   *   `success`, so renderers can keep displaying partial outputs on failure.
   */
  private toResult(output: {
    content: string;
    error?: any;
    state?: any;
    success: boolean;
  }): BuiltinToolResult {
    const errorMessage =
      typeof output.error?.message === 'string' ? output.error.message : undefined;
    const safeContent =
      output.content || errorMessage || '[UNKNOWN_EXEC_ERROR] Tool execution failed';

    if (!output.success) {
      return {
        content: safeContent,
        error: output.error
          ? { body: output.error, message: errorMessage ?? safeContent, type: 'PluginServerError' }
          : undefined,
        state: output.state,
        success: false,
      };
    }
    return { content: safeContent, state: output.state, success: true };
  }

  // ==================== File Operations ====================

  listFiles = async (
    params: ListLocalFileParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const blocked = this.workspaceRequired(ctx);
    if (blocked) return blocked;
    try {
      const boundary = await this.executeOnDesktopBoundary('listFiles', params as any, ctx);
      if (boundary) return boundary;
      const resolved = resolveArgsWithScope(params, 'path', ctx?.workingDirectory);
      const result = await this.runtime.listFiles({
        directoryPath: resolved.path,
        limit: resolved.limit,
        sortBy: resolved.sortBy,
        sortOrder: resolved.sortOrder,
      } as any);
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  readFile = async (
    params:
      | LocalReadFileParams
      | (Omit<LocalReadFileParams, 'path'> & { attachmentId: string; path?: never }),
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const blocked = this.workspaceRequired(ctx);
    if (blocked) return blocked;
    try {
      const boundary = await this.executeOnDesktopBoundary('readFile', params as any, ctx);
      if (boundary) return boundary;
      if (params.path === undefined)
        return {
          success: false,
          content: 'Attachment tools require a bound device execution context',
        };
      const resolved = resolveArgsWithScope(params, 'path', ctx?.workingDirectory);
      const result = await this.runtime.readFile({
        endLine: resolved.loc?.[1],
        path: resolved.path,
        startLine: resolved.loc?.[0],
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  readFiles = async (
    params: LocalReadFilesParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const blocked = this.workspaceRequired(ctx);
    if (blocked) return blocked;
    try {
      const boundary = await this.executeOnDesktopBoundary('readFiles', params as any, ctx);
      if (boundary) return boundary;
      const paths = params.paths.map(
        (filePath) => resolveArgsWithScope({ path: filePath }, 'path', ctx?.workingDirectory).path,
      );
      const result = await this.runtime.readFiles({ paths });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  searchFiles = async (
    params: LocalSearchFilesParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const blocked = this.workspaceRequired(ctx);
    if (blocked) return blocked;
    try {
      const boundary = await this.executeOnDesktopBoundary('searchFiles', params as any, ctx);
      if (boundary) return boundary;
      const resolvedParams = resolveArgsWithScope(params, 'directory', ctx?.workingDirectory);
      const result = await this.runtime.searchFiles({
        ...resolvedParams,
        directory: resolvedParams.directory || '',
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  moveFiles = async (
    params: MoveLocalFilesParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const blocked = this.workspaceRequired(ctx);
    if (blocked) return blocked;
    try {
      const boundary = await this.executeOnDesktopBoundary('moveFiles', params as any, ctx);
      if (boundary) return boundary;
      const result = await this.runtime.moveFiles({
        operations: params.items.map((item) => ({
          destination: resolveArgsWithScope({ path: item.newPath }, 'path', ctx?.workingDirectory)
            .path,
          source: resolveArgsWithScope({ path: item.oldPath }, 'path', ctx?.workingDirectory).path,
        })),
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  writeFile = async (
    params: WriteLocalFileParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const blocked = this.workspaceRequired(ctx);
    if (blocked) return blocked;
    try {
      const boundary = await this.executeOnDesktopBoundary('writeFile', params as any, ctx);
      if (boundary) return boundary;
      const result = await this.runtime.writeFile(
        resolveArgsWithScope(params, 'path', ctx?.workingDirectory),
      );
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  editFile = async (
    params: EditLocalFileParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const blocked = this.workspaceRequired(ctx);
    if (blocked) return blocked;
    try {
      const boundary = await this.executeOnDesktopBoundary('editFile', params as any, ctx);
      if (boundary) return boundary;
      const resolved = resolveArgsWithScope(params, 'file_path', ctx?.workingDirectory);
      const result = await this.runtime.editFile({
        all: resolved.replace_all,
        path: resolved.file_path,
        replace: resolved.new_string,
        search: resolved.old_string,
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  // ==================== Shell Commands ====================

  runCommand = async (
    params: RunCommandParams & { attachmentId?: string },
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const blocked = this.workspaceRequired(ctx);
    if (blocked) return blocked;
    try {
      const boundary = await this.executeOnDesktopBoundary('runCommand', params as any, ctx);
      if (boundary) return boundary;
      // The manifest exposes `run_in_background`, but ComputerRuntime's RunCommandState
      // reads `args.background` for the `isBackground` field — without this normalize
      // the UI/state would always say foreground even for background commands.
      // The IPC handler reads `run_in_background` itself, so we keep that field too.
      const result = await this.runtime.runCommand({
        ...params,
        background: params.run_in_background,
        cwd: ctx?.workingDirectory ?? params.cwd,
        env: ctx ? undefined : params.env,
      } as any);
      const output = this.toResult(result);
      if (!ctx?.workingDirectory || !params.cwd || params.cwd === ctx.workingDirectory)
        return output;
      return {
        ...output,
        state: {
          ...(typeof output.state === 'object' && output.state
            ? output.state
            : { result: output.state }),
          workspaceWarnings: [{ code: 'MODEL_CWD_OVERRIDDEN', overridden: true }],
        },
      };
    } catch (error) {
      return this.errorResult(error);
    }
  };

  getCommandOutput = async (
    params: GetCommandOutputParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const boundary = await this.executeOnDesktopBoundary('getCommandOutput', params as any, ctx);
      if (boundary) return boundary;
      const result = await this.runtime.getCommandOutput({
        commandId: params.shell_id,
        filter: params.filter,
      } as any);
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  killCommand = async (
    params: KillCommandParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const boundary = await this.executeOnDesktopBoundary('killCommand', params as any, ctx);
      if (boundary) return boundary;
      const result = await this.runtime.killCommand({
        commandId: params.shell_id,
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  // ==================== Search & Find ====================

  grepContent = async (
    params: GrepContentParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const blocked = this.workspaceRequired(ctx);
    if (blocked) return blocked;
    try {
      const boundary = await this.executeOnDesktopBoundary('grepContent', params as any, ctx);
      if (boundary) return boundary;
      const resolvedParams = resolveArgsWithScope(params, 'path', ctx?.workingDirectory);
      // Forward the full IPC params (glob / output_mode / -i / -A / -B / -C / -n /
      // multiline / head_limit / type / tool) instead of stripping to {directory, pattern}.
      // ComputerRuntime.callService passes args through unchanged, so the runtime type
      // narrowing was the only blocker — the underlying rg/grep needs these flags to
      // honor the agent's filter and stop scanning dist/* and tsbuildinfo.
      const result = await this.runtime.grepContent(resolvedParams as any);
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  globFiles = async (
    params: GlobFilesParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const blocked = this.workspaceRequired(ctx);
    if (blocked) return blocked;
    if (ctx && isEscapingPathPattern(params.pattern)) {
      return {
        content: 'SCOPE_DENIED',
        error: { message: 'SCOPE_DENIED', type: 'PluginServerError' },
        success: false,
      };
    }
    try {
      const boundary = await this.executeOnDesktopBoundary('globFiles', params as any, ctx);
      if (boundary) return boundary;
      const result = await this.runtime.globFiles({
        directory: params.scope ?? ctx?.workingDirectory,
        pattern: params.pattern,
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  // ==================== Helpers ====================

  private errorResult(error: unknown): BuiltinToolResult {
    return {
      content: (error as Error).message,
      error: { body: error, message: (error as Error).message, type: 'PluginServerError' },
      success: false,
    };
  }
}

// Export the executor instance for registration
export const localSystemExecutor = new LocalSystemExecutor();
