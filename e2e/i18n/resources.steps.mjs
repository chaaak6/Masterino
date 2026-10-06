import { Given, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPrimaryLocales, root } from '../../scripts/i18nWorkflow/checkPrimaryLocales.mjs';
const read = (locale, namespace) =>
  JSON.parse(readFileSync(resolve(root, 'locales', locale, `${namespace}.json`), 'utf8'));
Given('the current frontend and native desktop language resources', function () {
  this.contract = checkPrimaryLocales();
});
Then('Chinese and Vietnamese contain every English key and interpolation variable', function () {
  assert.deepEqual(this.contract.errors, []);
  assert.ok(this.contract.checked > 23000);
});
Given('the interface language is {string}', function (locale) {
  this.locale = locale;
});
Then('the Aihub connection heading is {string}', function (heading) {
  assert.equal(read(this.locale, 'aihub').bindingTitle, heading);
});
Then('the screenshot send label is {string}', function (send) {
  assert.equal(read(this.locale, 'electron')['overlay.sendAriaLabel'], send);
});
Then('the login namespace has translated content', function () {
  const values = Object.values(read(this.locale, 'auth'));
  assert.ok(values.length > 100);
  if (this.locale === 'vi-VN') assert.ok(values.some((v) => String(v).includes('Đăng nhập')));
});
