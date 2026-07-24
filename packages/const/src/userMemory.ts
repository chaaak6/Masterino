import { DEFAULT_EMBEDDING_PROVIDER } from '@lobechat/business-const';

export const DEFAULT_SEARCH_USER_MEMORY_TOP_K = {
  activities: 3,
  contexts: 0,
  experiences: 0,
  preferences: 3,
};

export const MEMORY_SEARCH_TOP_K_LIMITS = {
  high: { activities: 6, contexts: 4, experiences: 4, preferences: 6 },
  low: { activities: 2, contexts: 0, experiences: 0, preferences: 2 },
  medium: { ...DEFAULT_SEARCH_USER_MEMORY_TOP_K },
} as const;

export interface UserMemoryConfigItem {
  model: string;
  provider: string;
}

export interface UserMemoryConfig {
  embeddingModel: UserMemoryConfigItem;
}

export const DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM: UserMemoryConfigItem = {
  // User-memory vectors are stored at 2,048 dimensions. The generic
  // text-embedding-3-small default tops out below that size, while
  // text-embedding-3-large supports the requested reduced dimension.
  model: 'text-embedding-3-large',
  provider: DEFAULT_EMBEDDING_PROVIDER,
};

export const DEFAULT_USER_MEMORY_CONFIG: UserMemoryConfig = {
  embeddingModel: DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM,
};

export const DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS = 2048;
