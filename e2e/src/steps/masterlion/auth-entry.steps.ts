import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { CustomWorld } from '../../support/world';
import { WAIT_TIMEOUT } from '../../support/world';

const emailOrUsernameInput = 'input[type="email"], input[name="email"], input[type="text"]';
const passwordInput = 'input[type="password"], input[name="password"]';

Given('I use a fresh unauthenticated browser session', async function (this: CustomWorld) {
  await this.browserContext.clearCookies();
  await this.page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

When('I visit the onboarding entry', async function (this: CustomWorld) {
  this.testContext.lastResponse = await this.page.goto('/onboarding', {
    waitUntil: 'domcontentloaded',
  });
  await this.page.waitForLoadState('networkidle', { timeout: WAIT_TIMEOUT }).catch(() => {});
});

Then(
  'I should land on the signin page with onboarding callback',
  async function (this: CustomWorld) {
    await expect(this.page).toHaveURL(/\/signin\?callbackUrl=.*%2Fonboarding/, {
      timeout: WAIT_TIMEOUT,
    });
    await expect(this.page.locator('#loading-screen')).toHaveCount(0, { timeout: WAIT_TIMEOUT });
    await expect(this.page.getByText('error.title')).toHaveCount(0);
  },
);

Then('I should see the login entry form', async function (this: CustomWorld) {
  await expect(this.page.locator(emailOrUsernameInput).first()).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
  await expect(this.page.locator('form button').first()).toBeVisible({ timeout: WAIT_TIMEOUT });
});

When('I open the signup page', async function (this: CustomWorld) {
  this.testContext.lastResponse = await this.page.goto('/signup', {
    waitUntil: 'domcontentloaded',
  });
  await this.page.waitForLoadState('networkidle', { timeout: WAIT_TIMEOUT }).catch(() => {});
});

Then('I should see the registration form', async function (this: CustomWorld) {
  await expect(this.page).toHaveURL(/\/signup/, { timeout: WAIT_TIMEOUT });
  await expect(this.page.locator(emailOrUsernameInput).first()).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
  await expect(this.page.locator(passwordInput)).toHaveCount(2, { timeout: WAIT_TIMEOUT });
  await expect(this.page.locator('form button[type="submit"], form button').first()).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
});

When('I open the signin page', async function (this: CustomWorld) {
  this.testContext.lastResponse = await this.page.goto('/signin', {
    waitUntil: 'domcontentloaded',
  });
  await this.page.waitForLoadState('networkidle', { timeout: WAIT_TIMEOUT }).catch(() => {});
});
