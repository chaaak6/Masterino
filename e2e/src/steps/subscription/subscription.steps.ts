import { After, Before, Given, setDefaultTimeout,Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { CustomWorld } from '../../support/world';

setDefaultTimeout(30_000);

Before(async function (this: CustomWorld) {
  await this.init();
});
After(async function (this: CustomWorld, { result }) {
  if (result?.status === 'FAILED') await this.takeScreenshot('subscription-failure');
  if (this.testContext.scenario === 'active' && result?.status !== 'FAILED')
    await this.takeScreenshot('subscription-details');
  await this.page.unrouteAll({ behavior: 'wait' });
  await this.cleanup();
});
Given(
  'the subscription preview has {string} data',
  async function (this: CustomWorld, scenario: string) {
    if (scenario === 'narrow') await this.page.setViewportSize({ width: 760, height: 900 });
    await this.page.clock.install({ time: new Date('2026-10-07T04:00:00Z') });
    this.testContext.scenario = scenario;
    this.testContext.modelRequests = 0;
    this.page.on('request', (request) => {
      if (/syncModels|ensureReadiness/.test(request.url())) this.testContext.modelRequests++;
    });
    await this.page.route('**/fixture/subscriptions', async (route) => {
      if (scenario === 'error') {
        await route.fulfill({ status: 503, body: '{}' });
        return;
      }
      const data = {
        billingPreference: 'subscription_first',
        subscriptions: [
          {
            id: 1,
            title: '通用订阅 · 每月重置额度',
            status: 'active',
            amountTotal: 50000000,
            amountUsed: 7685000,
            startTime: 1790730919,
            endTime: 1822266919,
            nextResetTime: 1793462400,
            resetAmount: 50000000,
            allowWalletOverflow: true,
          },
        ],
      };
      if (scenario === 'pending') data.subscriptions[0].nextResetTime = 1790784000;
      if (scenario === 'wallet') data.billingPreference = 'wallet_first';
      if (scenario === 'none') data.subscriptions = [];
      if (scenario === 'exhausted') data.subscriptions[0].amountUsed = 50000000;
      if (scenario === 'expired') data.subscriptions[0].endTime = 1759194919;
      if (scenario === 'multiple')
        data.subscriptions.push({
          ...data.subscriptions[0],
          id: 2,
          title: '额外订阅',
          amountTotal: 10000000,
          amountUsed: 1000000,
          resetAmount: 10000000,
          nextResetTime: 1793548800,
        });
      await route.fulfill({ json: data });
    });
    await this.page.goto('/settings/provider/newapi');
    await expect(this.page.getByText('钱包余额', { exact: true })).toBeVisible();
  },
);
When('I open the avatar account card', async function (this: CustomWorld) {
  await this.page.getByRole('button', { name: /测试用户/ }).click();
  await expect(this.page.locator('.menu')).toBeVisible();
  if (this.testContext.scenario === 'active') await this.takeScreenshot('subscription-avatar');
});
Then(
  'the card shows {string} and {string}',
  async function (this: CustomWorld, label: string, value: string) {
    await expect(this.page.locator('.menu').getByText(label, { exact: true })).toBeVisible();
    await expect(this.page.locator('.menu').getByText(value, { exact: true })).toBeVisible();
  },
);
Then('the account card does not show requests', async function (this: CustomWorld) {
  await expect(this.page.locator('.menu').getByText('请求数')).toHaveCount(0);
});
When('I open the account details', async function (this: CustomWorld) {
  await this.page.locator('.menu').getByRole('link', { name: /AIHUB/ }).click();
  await expect(this.page.locator('.menu')).toHaveCount(0);
  await expect(this.page).toHaveURL(/\/settings\/provider\/newapi$/);
});
Then(
  'the provider shows {string} and {string}',
  async function (this: CustomWorld, label: string, value: string) {
    await expect(
      this.page.locator('main').getByText(label, { exact: false }).first(),
    ).toBeVisible();
    await expect(
      this.page.locator('main').getByText(value, { exact: false }).first(),
    ).toBeVisible();
  },
);
Then('the subscription action is {string}', async function (this: CustomWorld, label: string) {
  const action = this.page.getByRole('link', { name: label, exact: true });
  await expect(action).toHaveAttribute('href', 'https://aihub.bielcrystal.com/');
  await expect(action).toHaveAttribute('target', '_blank');
});
Then('opening the avatar does not refresh models', function (this: CustomWorld) {
  expect(this.testContext.modelRequests).toBe(0);
});
Then('the provider does not offer a false subscription state', async function (this: CustomWorld) {
  await expect(this.page.getByText('暂无有效订阅', { exact: true })).toHaveCount(0);
  await expect(this.page.getByRole('link', { name: '开通订阅', exact: true })).toHaveCount(0);
});
Then('two subscription plans are visible', async function (this: CustomWorld) {
  await expect(
    this.page.getByRole('region', { name: '订阅', exact: true }).getByRole('article'),
  ).toHaveCount(2);
});
Then('the subscription content does not overflow the viewport', async function (this: CustomWorld) {
  const width = await this.page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});
