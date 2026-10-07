export const DEFAULT_EMBEDDING_PROVIDER = 'newapi';

// Keep model defaults and the explicit deployment override in one place.
const configuredAihubModel = process.env.AIHUB_DEFAULT_MODEL;
const DEFAULT_AIHUB_MODEL = configuredAihubModel || 'glm-5.2';

// Defaults for new assistants and the five tasks under Model assignments.
// Other tasks retain their existing defaults.
export const DEFAULT_MODEL_ASSIGNMENT_MODEL = configuredAihubModel || 'deepseek-v4-flash';

export const DEFAULT_MODEL = DEFAULT_AIHUB_MODEL;
export const DEFAULT_PROVIDER = 'newapi';
export const DEFAULT_MINI_MODEL = DEFAULT_AIHUB_MODEL;
export const DEFAULT_MINI_PROVIDER = 'newapi';

export const DEFAULT_ONBOARDING_MODEL = DEFAULT_AIHUB_MODEL;
export const DEFAULT_ONBOARDING_PROVIDER = 'newapi';

// Server-side deny-list of Aihub model ids that must never be synced into the
// ai_models table, even when the Aihub abilities table still reports them as
// enabled for the user's group. Comma-separated, e.g. "glm-5.1,gpt-3.5-turbo".
// Used by NewApiService.syncModelsForBinding to filter the remote model list
// before clearRemoteModels + batchUpdateAiModels, so stale models disappear on
// the next "刷新模型" instead of being re-inserted.
//
// Read lazily on each call (not captured at module load) so tests can flip the
// env var between cases without re-importing the module.
export const isAihubModelHidden = (modelId: string): boolean => {
  const hidden = (process.env.AIHUB_HIDDEN_MODELS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return hidden.includes(modelId);
};
