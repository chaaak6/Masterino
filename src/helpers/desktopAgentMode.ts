import type { LobeAgentChatConfig } from '@lobechat/types';

const projections = new WeakMap<LobeAgentChatConfig, LobeAgentChatConfig>();
const emptyConfig: LobeAgentChatConfig = {};

/** Request-local desktop policy. Never write this projection back to the shared agent. */
export const resolveDesktopChatConfig = (
  config: LobeAgentChatConfig | undefined,
  desktop: boolean,
): LobeAgentChatConfig | undefined => {
  if (!desktop) return config;
  const source = config ?? emptyConfig;
  const cached = projections.get(source);
  if (cached) return cached;
  const resolved: LobeAgentChatConfig = {
    ...config,
    enableAgentMode: true,
    // Preserve intentional custom toolsets; only remove the plain-chat gate.
    toolMode: config?.toolMode === 'custom' ? 'custom' : 'agent',
  };
  projections.set(source, resolved);
  return resolved;
};
