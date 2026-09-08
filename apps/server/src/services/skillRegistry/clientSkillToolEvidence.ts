import {
  resolveExecutionContext,
  type ResolveExecutionContextInput,
} from '@/helpers/executionContext';

/** Preserve the configured target: a device binding must never become cloud authority. */
export const resolveClientSkillSandboxContext = (input: ResolveExecutionContextInput) => {
  const context = resolveExecutionContext({ ...input, canUseDevice: true });
  if (context.plan.kind !== 'sandbox') throw new Error('SKILL_SANDBOX_BINDING_REQUIRED');
  return context;
};

interface TopicEvidence {
  agentId?: string | null;
  id: string;
}
interface MessageEvidence {
  agentId?: string | null;
  groupId?: string | null;
  id: string;
  parentId?: string | null;
  role: string;
  threadId?: string | null;
  tools?: unknown;
  topicId?: string | null;
}
interface PluginEvidence {
  apiName?: string;
  arguments?: string;
  identifier?: string;
  toolCallId?: string;
}
export interface ClientSkillToolRequest {
  apiName: 'activateSkill' | 'readReference' | 'execScript';
  messageId: string;
  topicId: string;
}
/** Verify owned message evidence only. Skill selection remains in SkillRegistryService. */
export async function resolveOwnedClientSkillTool(
  input: ClientSkillToolRequest,
  storage: {
    findTopic: (id: string) => Promise<TopicEvidence | undefined>;
    findMessage: (id: string) => Promise<MessageEvidence | undefined>;
    findPlugin: (id: string) => Promise<PluginEvidence | undefined>;
  },
) {
  const [topic, message, plugin] = await Promise.all([
    storage.findTopic(input.topicId),
    storage.findMessage(input.messageId),
    storage.findPlugin(input.messageId),
  ]);
  if (
    !topic ||
    !message ||
    message.topicId !== topic.id ||
    message.role !== 'tool' ||
    !message.parentId ||
    plugin?.identifier !== 'lobe-skills' ||
    plugin.apiName !== input.apiName ||
    !plugin.toolCallId
  )
    throw new Error('SKILL_TOOL_MESSAGE_NOT_OWNED');
  const parent = await storage.findMessage(message.parentId);
  if (
    !parent ||
    parent.topicId !== topic.id ||
    parent.role !== 'assistant' ||
    !Array.isArray(parent.tools) ||
    !parent.tools.some(
      (tool) =>
        tool &&
        typeof tool === 'object' &&
        tool.id === plugin.toolCallId &&
        tool.identifier === 'lobe-skills' &&
        tool.apiName === input.apiName,
    )
  )
    throw new Error('SKILL_TOOL_CALL_MISMATCH');
  const agentId = message.agentId ?? topic.agentId;
  if (!agentId || (topic.agentId && topic.agentId !== agentId))
    throw new Error('SKILL_AGENT_MISMATCH');
  let ancestor = parent;
  const seen = new Set<string>();
  while (ancestor.parentId) {
    if (seen.has(ancestor.id) || seen.size >= 64) throw new Error('SKILL_MESSAGE_CHAIN_INVALID');
    seen.add(ancestor.id);
    const previous = await storage.findMessage(ancestor.parentId);
    if (!previous || previous.topicId !== topic.id) throw new Error('SKILL_MESSAGE_CHAIN_INVALID');
    if (previous.role === 'user') break;
    ancestor = previous;
  }
  let args: unknown;
  try {
    args = JSON.parse(plugin.arguments ?? '{}');
  } catch {
    throw new Error('SKILL_TOOL_ARGUMENTS_INVALID');
  }
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('SKILL_TOOL_ARGUMENTS_INVALID');
  return {
    agentId,
    args: args as Record<string, unknown>,
    message,
    topic,
    operationId: `client-message:${ancestor.id}`,
    toolCallId: plugin.toolCallId,
  };
}
