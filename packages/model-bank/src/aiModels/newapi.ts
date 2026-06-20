import type { AIChatModelCard } from '../types/aiModel';

// Aihub router provider - company deployments fetch the final model list dynamically.
// Keep one enabled chat fallback so default agents have a valid Aihub landing model before sync.
const DEFAULT_AIHUB_MODEL = process.env.AIHUB_DEFAULT_MODEL || 'glm-5.1';

const newapiChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, search: true },
    contextWindowTokens: 200_000,
    displayName: 'GLM-5.1',
    enabled: true,
    id: DEFAULT_AIHUB_MODEL,
    type: 'chat',
  },
];

export const allModels = [...newapiChatModels];

export default allModels;
