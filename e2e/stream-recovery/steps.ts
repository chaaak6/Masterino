import { mkdir } from 'node:fs/promises';

import { After, Given, setDefaultTimeout, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

setDefaultTimeout(300_000);
let app: any;
let page: any;
let requests: string[] = [];
let consoleErrors: string[] = [];
let pageErrors: string[] = [];
let failedRequests: Array<{ url: string; reason: string }> = [];

Given('打开使用生产运行状态的隔离测试 App', async () => {
  const { launchElectronTestApp } = await import('../electron/support/electronTestApp.mjs');
  app = await launchElectronTestApp({ skipBuild: process.env.STREAM_BDD_PREBUILT === '1' });
  page = await app.firstWindow();
  requests = [];
  consoleErrors = [];
  pageErrors = [];
  failedRequests = [];
  page.on('request', (request: any) => {
    if (request.url().includes(':14321/')) requests.push(request.url());
  });
  page.on('pageerror', (error: Error) => pageErrors.push(error.message));
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
  await app.evaluate(({ session }: any) => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['https://masterino.bielcrystal.com/*', 'https://aihub.bielcrystal.com/*'] },
      (_details: unknown, callback: (result: { cancel: boolean }) => void) =>
        callback({ cancel: true }),
    );
  });
  await expect(page.getByRole('button', { name: 'Run stream scenario' })).toBeVisible();
});

When('运行 {string} 网络场景', async (scenario: string) => {
  await page.getByRole('combobox', { name: 'Stream scenario' }).selectOption(scenario);
  await page.getByRole('button', { name: 'Run stream scenario' }).click();
});

Then('运行结果为 {string} 且请求次数为 {int}', async (result: string, attempts: number) => {
  await expect(page.getByTestId('stream-status')).toHaveText(result, { timeout: 30_000 });
  await expect(page.getByTestId('stream-attempts')).toHaveText(String(attempts));
  await expect(page.getByTestId('stream-operation-status')).toHaveText(
    result === 'stopped' ? 'cancelled' : result,
  );
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

Then('网关运行最终为 {string}', async (result: string) => {
  await expect(page.getByTestId('stream-operation-status')).toHaveText(result, { timeout: 60_000 });
  await expect(page.getByTestId('stream-status')).toHaveText(result);
});
Then('订阅共请求 {int} 次', async (count: number) => {
  expect(requests.filter((url) => url.includes('operationId='))).toHaveLength(count);
});
Then('结果同步失败但保留正文', async () => {
  await expect(page.getByTestId('stream-sync-error')).not.toBeEmpty();
  await expect(page.getByTestId('stream-content')).toContainText('Report complete');
  await expect(page.getByTestId('stream-inline-error')).toBeEmpty();
});
When('点击刷新已保存的结果', async () => {
  await page.getByRole('button', { name: 'Refresh saved results' }).click();
});
Then('结果已同步且没有重新生成', async () => {
  await expect(page.getByTestId('stream-sync-error')).toBeEmpty();
  await expect(page.getByTestId('stream-content')).toContainText('Saved report');
  expect(requests.filter((url) => url.includes('operationId='))).toHaveLength(1);
});
Then('补拉超时后发送区已释放', async () => {
  await expect(page.getByTestId('stream-operation-status')).toHaveText('completed', { timeout: 7000 });
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('stream-content')).toContainText('Report complete');
});
Then('结果刷新请求已发出', async () => {
  await expect
    .poll(() =>
      requests.some(
        (url) => url.includes('scenario=snapshot') && url.includes('gateway-snapshot-cancel'),
      ),
    )
    .toBe(true);
  await expect(page.getByTestId('stream-send-state')).toHaveAttribute('data-generating', 'true');
});
Then('迟到错误后仍保持取消', async () => {
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('stream-operation-status')).toHaveText('cancelled');
  await expect(page.getByTestId('stream-inline-error')).toBeEmpty();
  await expect(page.getByTestId('stream-content')).toContainText('Report complete');
});
When('点击重试生成并恢复服务', async () => {
  await page.getByRole('combobox', { name: 'Stream scenario' }).selectOption('success');
  requests = [];
  await page.getByRole('button', { name: 'Retry generation' }).click();
});

After(async function (scenario) {
  if (!app) return;
  await mkdir('reports/stream-recovery', { recursive: true });
  await page.screenshot({ path: `reports/stream-recovery/${scenario.pickle.id}.png` });
  await this.attach(
    JSON.stringify({ networkRequests: requests, failedRequests, consoleErrors, pageErrors }),
    'application/json',
  );
  await app.close();
  app = undefined;
  expect(pageErrors).toEqual([]);
});
