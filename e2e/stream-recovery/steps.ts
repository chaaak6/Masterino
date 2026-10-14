import { After, Given, Then, When, setDefaultTimeout } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

setDefaultTimeout(300_000);
let app: any;
let page: any;
let requests: string[] = [];
let consoleErrors: string[] = [];
let failedRequests: Array<{ url: string; reason: string }> = [];

Given('打开使用生产运行状态的隔离测试 App', async () => {
  const { launchElectronTestApp } = await import('../electron/support/electronTestApp.mjs');
  app = await launchElectronTestApp({ skipBuild: process.env.STREAM_BDD_PREBUILT === '1' });
  page = await app.firstWindow();
  requests = [];
  consoleErrors = [];
  failedRequests = [];
  page.on('request', (request: any) => {
    if (request.url().includes(':14321/')) requests.push(request.url());
  });
  page.on('pageerror', (error: Error) => consoleErrors.push(error.message));
  page.on('console', (message: any) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request: any) => {
    if (request.url().includes(':14321/'))
      failedRequests.push({
        url: request.url(),
        reason: request.failure()?.errorText ?? 'unknown',
      });
  });
  await page.route(/https:\/\/(masterino|aihub)\.bielcrystal\.com\//, (route: any) =>
    route.abort(),
  );
  await expect(page.getByRole('button', { name: 'Run stream scenario' })).toBeVisible();
});

When('运行 {string} 网络场景', async (scenario: string) => {
  await page.getByRole('combobox', { name: 'Stream scenario' }).selectOption(scenario);
  await page.getByRole('button', { name: 'Run stream scenario' }).click();
});

Then('运行结果为 {string} 且请求次数为 {int}', async (result: string, attempts: number) => {
  await expect(page.getByTestId('stream-status')).toHaveText(result, { timeout: 30_000 });
  await expect(page.getByTestId('stream-attempts')).toHaveText(String(attempts));
  expect(requests).toHaveLength(attempts);
  if (result === 'failed')
    await expect(page.getByRole('button', { name: 'Retry generation' })).toBeVisible();
});

Then('消息加载与发送按钮同时结束', async () => {
  await expect(page.getByTestId('stream-message-loading')).toHaveAttribute('data-loading', 'false');
  await expect(page.getByTestId('stream-send-state')).toHaveAttribute('data-generating', 'false');
});

Then('消息与停止按钮同时保持运行', async () => {
  await expect(page.getByTestId('stream-content')).toContainText('Report');
  await expect(page.getByTestId('stream-message-loading')).toHaveAttribute('data-loading', 'true');
  await expect(page.getByTestId('stream-send-state')).toHaveAttribute('data-generating', 'true');
});

Then('自动恢复期间消息与停止按钮同时保持运行', async () => {
  await expect(page.getByTestId('stream-status')).toContainText('retrying');
  await expect(page.getByTestId('stream-message-loading')).toHaveAttribute('data-loading', 'true');
  await expect(page.getByTestId('stream-send-state')).toHaveAttribute('data-generating', 'true');
});

When('用户停止当前运行', async () => {
  await page.getByTestId('stream-send-state').locator('button').click();
});

When('网络暂时离线', async () => {
  await page.context().setOffline(true);
});
When('网络恢复在线', async () => {
  await page.context().setOffline(false);
});

Then('后续流内容不会进入消息', async () => {
  const before = await page.getByTestId('stream-content').textContent();
  await page.waitForTimeout(5500);
  await expect(page.getByTestId('stream-content')).toHaveText(before);
  await expect(page.getByTestId('stream-attempts')).toHaveText('1');
});

After(async function (scenario) {
  if (!app) return;
  await mkdir('reports/stream-recovery', { recursive: true });
  await page.screenshot({ path: `reports/stream-recovery/${scenario.pickle.id}.png` });
  await this.attach(
    JSON.stringify({ networkRequests: requests, failedRequests, consoleErrors }),
    'application/json',
  );
  await app.close();
  app = undefined;
});
