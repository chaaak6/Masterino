import { describe, expect, it } from 'vitest';

import { normalizeLocale } from '../resources';

describe('native locale resource directory names', () => {
  it.each([
    ['vi', 'vi-VN'],
    ['vi_vn', 'vi-VN'],
    ['VI-vn', 'vi-VN'],
    ['zh', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-hant-HK', 'zh-TW'],
    ['en-GB', 'en'],
    ['en-US', 'en'],
    ['fr-CA', 'fr-FR'],
    ['pt-PT', 'pt-BR'],
    ['ar-EG', 'ar'],
    ['unknown', 'en'],
  ])('%s resolves to %s', (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });
});
