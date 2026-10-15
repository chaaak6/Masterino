import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';

// Apply only during creation so users can remove the tool afterwards.
export const getNewAgentPlugins = (plugins: string[] = []): string[] => [
  ...new Set([...plugins, UserInteractionIdentifier]),
];
