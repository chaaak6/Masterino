export const DEFAULT_EMBEDDING_PROVIDER = 'newapi';

// Single source of truth for the Aihub default model. All packages import
// DEFAULT_MODEL / DEFAULT_MINI_MODEL / DEFAULT_ONBOARDING_MODEL from here;
// do not re-read AIHUB_DEFAULT_MODEL elsewhere.
const DEFAULT_AIHUB_MODEL = process.env.AIHUB_DEFAULT_MODEL || 'glm-5.2';

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
