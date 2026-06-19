import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import { DEFAULT_HOME_NEW_MODELS, NEW_CHAT_MODEL, NEW_CHAT_PROVIDER } from './starterModels';

describe('starter models', () => {
  it('uses the internal Aihub default model and provider', () => {
    expect(NEW_CHAT_MODEL).toBe(DEFAULT_MODEL);
    expect(NEW_CHAT_PROVIDER).toBe(DEFAULT_PROVIDER);
  });

  it('keeps the fallback home new model list locked to Aihub chat', () => {
    expect(DEFAULT_HOME_NEW_MODELS).toEqual([
      {
        model: DEFAULT_MODEL,
        provider: DEFAULT_PROVIDER,
        title: 'Aihub 默认模型',
        type: 'chat',
      },
    ]);
  });
});
