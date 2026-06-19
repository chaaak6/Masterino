import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@lobechat/business-const';

import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';

// Chat
export const NEW_CHAT_MODEL = DEFAULT_MODEL;
export const NEW_CHAT_PROVIDER = DEFAULT_PROVIDER;
export const NEW_CHAT_MODEL_NAME = 'Aihub 默认模型';

const BUSINESS_HOME_NEW_MODELS = [
  {
    model: NEW_CHAT_MODEL,
    provider: NEW_CHAT_PROVIDER,
    title: NEW_CHAT_MODEL_NAME,
    type: 'chat',
  },
] satisfies HomeNewModelItem[];

export const DEFAULT_HOME_NEW_MODELS = BUSINESS_HOME_NEW_MODELS;
