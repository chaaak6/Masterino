/**
 * Lobe Skills Executor
 *
 * Creates and exports the SkillsExecutor instance for registration.
 * Injects agentSkillService as dependency.
 */
import { builtinSkills } from '@lobechat/builtin-skills';
import { SkillsExecutionRuntime } from '@lobechat/builtin-tool-skills/executionRuntime';
import { SkillsExecutor } from '@lobechat/builtin-tool-skills/executor';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';

import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { toolsClient } from '@/libs/trpc/client';
import { cloudSandboxService } from '@/services/cloudSandbox';
import { agentSkillService } from '@/services/skill';

// Create runtime with client-side service
const createRuntime = (ctx: BuiltinToolContext) =>
  new SkillsExecutionRuntime({
    executionContext: ctx.executionContext,
    registryResult: { skills: ctx.operationSkills ?? [] },
    builtinSkills: filterBuiltinSkills(builtinSkills),
    service: {
      exportFile: async (path, filename) => {
        // Get current session context
        const topicId = ctx.topicId;
        if (!topicId) throw new Error('SKILL_OPERATION_BINDING_REQUIRED');

        try {
          // Call cloud sandbox exportAndUploadFile
          const result = await cloudSandboxService.exportAndUploadFile(path, filename, topicId);

          return {
            fileId: result.fileId,
            filename: result.filename,
            mimeType: result.mimeType,
            size: result.size,
            success: result.success,
            url: result.url,
          };
        } catch {
          return {
            filename,
            success: false,
          };
        }
      },
      findAll: () => agentSkillService.list(),
      findById: (id) => agentSkillService.getById(id),
      findByName: (name) => agentSkillService.getByName(name),
      readResource: (id, path) => agentSkillService.readResource(id, path),
      runCommand: async ({ command, timeout }) => {
        // Cloud: execute via Cloud Sandbox
        // Get current session context for sandbox isolation
        const topicId = ctx.topicId;
        if (!topicId) throw new Error('SKILL_OPERATION_BINDING_REQUIRED');

        try {
          // Call cloud sandbox via TRPC
          // Note: userId is automatically set by server from authenticated context
          const result = await cloudSandboxService.callTool(
            'runCommand',
            {
              command,
              description: `Execute skill command: ${command.slice(0, 100)}${command.length > 100 ? '...' : ''}`,
              timeout,
            },
            { topicId },
          );

          if (!result.success) {
            return {
              exitCode: 1,
              output: '',
              stderr: result.error?.message || 'Command execution failed',
              success: false,
            };
          }

          // Parse cloud sandbox result
          const sandboxResult = result.result || {};

          return {
            exitCode: sandboxResult.exitCode ?? (result.success ? 0 : 1),
            output: sandboxResult.stdout || sandboxResult.output || '',
            stderr: sandboxResult.stderr || '',
            success:
              result.success &&
              (sandboxResult.exitCode === 0 || sandboxResult.exitCode === undefined),
          };
        } catch (error) {
          return {
            exitCode: 1,
            output: '',
            stderr: (error as Error).message || 'Command execution failed',
            success: false,
          };
        }
      },
    },
  });

// Create executor instance with the runtime
const invokeBoundSkill = async (
  apiName: 'activateSkill' | 'readReference' | 'execScript',
  ctx: BuiltinToolContext,
): Promise<BuiltinToolResult> => {
  if (ctx.signal?.aborted) return { success: false, stop: true };
  if (!ctx.topicId || !ctx.messageId)
    return { success: false, content: 'SKILL_OPERATION_BINDING_REQUIRED' };
  try {
    return await toolsClient.market.executeSkillTool.mutate({
      apiName,
      topicId: ctx.topicId,
      messageId: ctx.messageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, content: message, error: { message, type: 'PluginServerError' } };
  }
};

// Skill identity, version and package execution share the server Runtime.
// General commands and file export retain their existing sandbox service.
export const skillsExecutor = Object.assign(new SkillsExecutor(createRuntime), {
  activateSkill: (_params: unknown, ctx: BuiltinToolContext) =>
    invokeBoundSkill('activateSkill', ctx),
  readReference: (_params: unknown, ctx: BuiltinToolContext) =>
    invokeBoundSkill('readReference', ctx),
  execScript: (_params: unknown, ctx: BuiltinToolContext) => invokeBoundSkill('execScript', ctx),
});
