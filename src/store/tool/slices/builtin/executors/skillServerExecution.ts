import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';

import { toolsClient } from '@/libs/trpc/client';

export const invokeBoundSkill = async (
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
