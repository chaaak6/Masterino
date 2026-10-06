import { describe, expect, it } from 'vitest';

import vi from '@/../locales/vi-VN/auth.json';
import zh from '@/../locales/zh-CN/auth.json';

import { createAuthI18n } from './createAuthI18n';

describe('authentication language resources', () => {
  it.each([
    ['zh-CN', zh],
    ['vi-VN', vi],
  ] as const)('loads %s instead of English', async (locale, expected) => {
    const { init, instance } = createAuthI18n(locale);
    await init({ initAsync: false });
    await instance.reloadResources([locale], ['auth']);
    const [key, value] = Object.entries(expected).find(([, value]) => typeof value === 'string')!;
    expect(instance.getResource(locale, 'auth', key)).toBe(value);
  });
  it('switches between all primary languages in the same instance', async () => {
    const { init, instance } = createAuthI18n('en-US');
    await init({ initAsync: false });
    for (const locale of ['vi-VN', 'zh-CN', 'en-US']) {
      await instance.changeLanguage(locale);
      await instance.reloadResources([locale], ['auth']);
      expect(instance.getResourceBundle(locale, 'auth')).toBeDefined();
    }
  });
});
