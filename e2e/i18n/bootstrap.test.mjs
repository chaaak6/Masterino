import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { root } from '../../scripts/i18nWorkflow/checkPrimaryLocales.mjs';

for (const file of ['index.html', 'apps/desktop/index.html', 'apps/desktop/popup.html']) {
  const html = readFileSync(resolve(root, file), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((m) =>
    m[1].includes('document.documentElement.lang'),
  )[1];
  const boot = (mode, cache, search = '', language = 'zh-CN') => {
    const document = {
      cookie: '',
      createElement: () => ({ style: {}, remove() {} }),
      documentElement: { setAttribute() {}, append() {} },
    };
    const location = { search, pathname: '/desktop-onboarding' };
    const window = { location, electronAPI: {}, matchMedia: () => ({ matches: false }) };
    const localStorage = {
      getItem: (key) => ({ 'masterino.localeMode': mode, 'i18nextLng': cache })[key],
    };
    runInNewContext(script, {
      document,
      window,
      location,
      localStorage,
      navigator: { language },
      URLSearchParams,
      HTMLScriptElement: { supports: () => true },
      getComputedStyle: () => ({ color: 'rgb(4, 5, 6)' }),
    });
    return document.documentElement.lang;
  };
  test(`${file}: persisted Vietnamese survives a stale URL on reload`, () =>
    assert.equal(boot('vi-VN', 'vi-VN', '?lng=zh-CN'), 'vi-VN'));
  test(`${file}: migrates an existing language cache`, () =>
    assert.equal(boot(null, 'vi-VN'), 'vi-VN'));
  test(`${file}: accepts the native startup locale`, () =>
    assert.equal(boot(null, null, '?lng=vi-VN'), 'vi-VN'));
  test(`${file}: automatic mode follows the current system language`, () =>
    assert.equal(boot('auto', 'zh-CN', '?lng=zh-CN', 'vi-VN'), 'vi-VN'));
}
