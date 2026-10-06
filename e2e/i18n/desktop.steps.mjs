import { AfterAll, Given, Then, When, setDefaultTimeout } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchDesktop, chooseLanguage, openOverlay, copy, root, testOrigin } from './desktop.mjs';
setDefaultTimeout(180000);
let run;
Given('an isolated desktop connected only to the test cluster', async function () {
  run ||= await launchDesktop();
  expect(run.backend).toBe(testOrigin);
});
When('I select interface language {string}', async function (locale) {
  this.locale = locale;
  await chooseLanguage(run.page, locale);
});
Then('the onboarding description is translated', async function () {
  await expect(run.page.locator('html')).toHaveAttribute('lang', this.locale);
  await expect(
    run.page.getByText(copy(this.locale, 'onboarding')['telemetry.rows.create.desc'], {
      exact: true,
    }),
  ).toBeVisible();
});
Then('the native edit menu is translated', async function () {
  const locale = this.locale === 'en-US' ? 'en' : this.locale;
  const resource = JSON.parse(
    readFileSync(resolve(root, 'apps/desktop/resources/locales', locale, 'menu.json'), 'utf8'),
  );
  await expect
    .poll(() =>
      run.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label)),
    )
    .toContain(resource['edit.title']);
});
Then('a new screenshot window uses the selected language', async function () {
  const overlay = await openOverlay(run.app);
  try {
    await expect(
      overlay.getByPlaceholder(copy(this.locale, 'electron')['overlay.idlePlaceholder']),
    ).toBeVisible();
    await expect(overlay.locator('html')).toHaveAttribute('lang', this.locale);
  } finally {
    await overlay.close();
  }
});
When('I restart the isolated desktop', async function () {
  const profile = run.id;
  await run.app.close();
  run = await launchDesktop(profile);
});
AfterAll(async () => {
  await run?.app.close();
});
