import { DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import { afterEach, describe, expect, it } from 'vitest';

import { parseMemoryExtractionConfig } from './parseMemoryExtractionConfig';

const ENV_KEYS = [
  'MEMORY_USER_MEMORY_GATEKEEPER_MODEL',
  'MEMORY_USER_MEMORY_GATEKEEPER_PROVIDER',
  'MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL',
  'MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PROVIDER',
  'MEMORY_USER_MEMORY_EMBEDDING_MODEL',
  'MEMORY_USER_MEMORY_EMBEDDING_PROVIDER',
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('parseMemoryExtractionConfig', () => {
  it('never inherits a chat model as the default embedding model', () => {
    process.env.MEMORY_USER_MEMORY_GATEKEEPER_MODEL = 'glm-5.2';
    process.env.MEMORY_USER_MEMORY_GATEKEEPER_PROVIDER = 'newapi';
    process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL = 'glm-5.2';
    process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PROVIDER = 'newapi';
    delete process.env.MEMORY_USER_MEMORY_EMBEDDING_MODEL;
    delete process.env.MEMORY_USER_MEMORY_EMBEDDING_PROVIDER;

    const { embedding } = parseMemoryExtractionConfig();

    expect(embedding.model).toBe(DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM.model);
    expect(embedding.provider).toBe(DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM.provider);
    expect(embedding.model).not.toBe('glm-5.2');
  });

  it('uses the explicitly configured Aihub embedding model', () => {
    process.env.MEMORY_USER_MEMORY_EMBEDDING_MODEL = 'text-embedding-3-large';
    process.env.MEMORY_USER_MEMORY_EMBEDDING_PROVIDER = 'newapi';

    expect(parseMemoryExtractionConfig().embedding).toMatchObject({
      model: 'text-embedding-3-large',
      provider: 'newapi',
    });
  });
});
