export const BRANDING_LOGO_URL = '/brand/masterlion/logo.png';
export const BRANDING_NAME = 'MasterLion';
// Desktop build stub for @lobechat/business-const. The web/server build reads
// AIHUB_DEFAULT_MODEL at runtime; Electron cannot, so these mirror the fallback
// value in packages/business/const/src/llm.ts. Keep both in sync.
export const DEFAULT_EMBEDDING_PROVIDER = 'newapi';
export const DEFAULT_MINI_MODEL = 'glm-5.2';
export const DEFAULT_MINI_PROVIDER = 'newapi';
export const DEFAULT_MODEL = 'glm-5.2';
export const DEFAULT_ONBOARDING_MODEL = 'glm-5.2';
export const DEFAULT_ONBOARDING_PROVIDER = 'newapi';
export const DEFAULT_PROVIDER = 'newapi';
export const ORG_NAME = '小宗狮';

// Desktop builds run without access to server env vars; the hidden-models
// deny-list is a server-side sync filter, so the stub is always permissive.
export const isAihubModelHidden = (_modelId: string): boolean => false;
