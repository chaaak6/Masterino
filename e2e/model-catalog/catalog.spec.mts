import { expect, test } from '@playwright/test';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

test.describe.configure({ mode: 'serial' });
const backend = 'http://127.0.0.1:19327';
const api = createTRPCClient<any>({
  links: [httpBatchLink({ url: `${backend}/trpc/lambda`, transformer: superjson })],
});

test.beforeAll(async ({ request }) => {
  await request.post(`${backend}/bdd/reset`);
});

test('Given a discovered model, When an administrator maintains/publishes/rolls back it, Then clients see only published content', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:19328/models');
  await expect(page.getByRole('heading', { name: '模型说明维护' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'bdd-chat' });
  await row.getByRole('button', { name: '维护', exact: true }).click();
  await page.getByLabel('展示名称', { exact: true }).fill('BDD Chat Pro');
  await page.getByLabel('上下文大小（tokens）', { exact: true }).fill('128000');
  await page.getByLabel('最大输出（tokens）', { exact: true }).fill('16000');
  await page.getByLabel('模型简介 / 推荐用途', { exact: true }).fill('用于 BDD 验证的模型说明');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /维护模型说明/ })).toHaveCount(0);
  await expect(row).toContainText('草稿');
  await row.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /草稿预览/ })).toContainText('128,000');
  await expect(page.getByRole('dialog', { name: /草稿预览/ })).toContainText('工具调用：待确认');
  await expect(page.getByRole('dialog', { name: /草稿预览/ })).toContainText('¥0.8');
  await page
    .getByRole('dialog', { name: /草稿预览/ })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await row.getByRole('button', { name: '发布', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认发布' })).toBeDisabled();
  await page.getByLabel('变更原因', { exact: true }).fill('BDD 首次发布');
  await page.getByRole('button', { name: '确认发布' }).click();
  await expect(row).toContainText('已发布');
  const first = await api.modelCatalog.check.query();
  expect(first.models.find((m: any) => m.id === 'bdd-chat').displayName).toBe('BDD Chat Pro');
  expect(first.models.find((m: any) => m.id === 'bdd-chat').contextWindowTokens).toBe(128000);
  await row.getByRole('button', { name: '维护', exact: true }).click();
  await page.getByLabel('展示名称', { exact: true }).fill('BDD Chat Next');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(row).toContainText('有草稿修改');
  expect((await api.modelCatalog.check.query({ knownRevision: first.revision })).status).toBe(
    'unchanged',
  );
  await row.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByLabel('变更原因', { exact: true }).fill('BDD 第二次发布');
  await page.getByRole('button', { name: '确认发布' }).click();
  await expect(row).toContainText('BDD Chat Next');
  await row.getByRole('button', { name: '历史', exact: true }).click();
  const historical = page.getByRole('row').filter({ hasText: 'BDD 首次发布' });
  await historical.getByRole('button', { name: '回滚到此版本' }).click();
  await page.getByLabel('变更原因', { exact: true }).fill('BDD 回滚验证');
  await page.getByRole('button', { name: '确认回滚', exact: true }).click();
  await expect(row).toContainText('BDD Chat Pro');
  await page.getByLabel('搜索模型', { exact: true }).fill('BDD Chat Pro');
  await expect(row).toBeVisible();
  await page.getByLabel('搜索模型', { exact: true }).fill('');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/masterino-model-catalog-bdd/admin.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Given the main interface, Then check once after mount, every 30 minutes, and preserve selected/running models', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('http://127.0.0.1:19329/refresh-harness.html');
  await page.clock.runFor(1001);
  await expect(page.getByTestId('checks')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'BDD Chat Pro', exact: true })).toBeVisible();
  await page.getByText('模型说明', { exact: true }).click();
  await expect(page.getByText('最大输出 tokens：16,000', { exact: true })).toBeVisible();
  await expect(page.getByText('工具调用：待确认', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(page.getByTestId('running')).toHaveText('128000');
  await page.clock.runFor(29 * 60_000);
  await expect(page.getByTestId('checks')).toHaveText('1');
  await page.clock.runFor(60_001);
  await expect(page.getByTestId('checks')).toHaveText('2');
  const list = await api.modelCatalog.list.query();
  const entry = list.records.find((record: any) => record.modelId === 'bdd-chat');
  const saved = await api.modelCatalog.saveDraft.mutate({
    modelId: entry.modelId,
    expectedVersion: entry.version,
    draft: { ...entry.draft, displayName: 'BDD Updated', contextWindowTokens: 64000 },
  });
  await api.modelCatalog.publish.mutate({
    modelId: entry.modelId,
    expectedVersion: saved.version,
    reason: 'BDD 静默更新',
  });
  await page.clock.runFor(30 * 60_000);
  await expect(page.getByRole('button', { name: 'BDD Updated', exact: true })).toBeVisible();
  const refreshed = await api.modelCatalog.check.query();
  const refreshedModel = refreshed.models.find((model: any) => model.id === 'bdd-chat');
  expect(refreshedModel.contextWindowTokens).toBe(128000);
  expect(refreshedModel.settings.managedModelCatalog.description.contextWindowTokens).toBe(64000);
  await expect(page.getByTestId('selected')).toHaveText('bdd-chat');
  await expect(page.getByTestId('running')).toHaveText('128000');
  await page.getByRole('button', { name: '开始手动刷新', exact: true }).click();
  const count = await page.getByTestId('checks').textContent();
  await page.clock.runFor(30 * 60_000);
  await expect(page.getByTestId('checks')).toHaveText(count!);
  await page.getByRole('button', { name: '结束手动刷新', exact: true }).click();
  await page.clock.runFor(30 * 60_000);
  await expect(page.getByRole('button', { name: 'BDD Updated', exact: true })).toBeVisible();
  const settings = (await api.modelCatalog.list.query()).settings;
  await api.modelCatalog.updateSettings.mutate({
    enabled: settings.enabled,
    silentRefreshEnabled: false,
  });
  await page.clock.runFor(30 * 60_000);
  await expect(page.getByRole('button', { name: '原有模型', exact: true })).toBeVisible();
  await api.modelCatalog.updateSettings.mutate({ enabled: true, silentRefreshEnabled: true });
  await page.clock.runFor(30 * 60_000);
  await expect(page.getByRole('button', { name: 'BDD Updated', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/masterino-model-catalog-bdd/refresh.png', fullPage: true });
});

test('Given an open model panel, When a published version changes, Then it shows the old list immediately and updates in place without duplicate checks', async ({
  page,
}) => {
  const initial = await api.modelCatalog.check.query();
  const oldName =
    initial.models.find((model: any) => model.id === 'bdd-chat').displayName ?? 'bdd-chat';
  await page.clock.install();
  await page.goto('http://127.0.0.1:19329/refresh-harness.html');
  await page.clock.runFor(1001);
  await expect(page.getByTestId('checks')).toHaveText('1');
  await page.getByRole('button', { name: '打开模型面板' }).click();
  await expect(page.getByTestId('checks')).toHaveText('1');
  const panel = page.getByTestId('model-panel');
  await expect(panel).toContainText(oldName);
  await panel.getByLabel('搜索面板模型').fill('bdd');
  const list = await api.modelCatalog.list.query();
  const entry = list.records.find((record: any) => record.modelId === 'bdd-chat');
  const saved = await api.modelCatalog.saveDraft.mutate({
    modelId: entry.modelId,
    expectedVersion: entry.version,
    draft: { ...entry.draft, displayName: 'BDD Panel Fresh', contextWindowTokens: 32000 },
  });
  await api.modelCatalog.publish.mutate({
    modelId: entry.modelId,
    expectedVersion: saved.version,
    reason: 'BDD 面板打开刷新',
  });
  await page.clock.runFor(2 * 60_000 + 1);
  await page.getByRole('button', { name: '关闭模型面板' }).click();
  await page.route('**/trpc/lambda/**', async (route) => {
    if (route.request().url().includes('modelCatalog.check'))
      await new Promise((r) => setTimeout(r, 300));
    await route.continue();
  });
  await page.getByRole('button', { name: '打开模型面板' }).click();
  await expect(panel).toContainText(oldName);
  await expect(page.getByTestId('checks')).toHaveText('2');
  await expect(panel).toContainText('BDD Panel Fresh');
  await expect(panel.getByLabel('搜索面板模型')).toHaveValue('bdd');
  await expect(page.getByTestId('panel-detail')).toHaveText('32000');
  await expect(page.getByTestId('selected')).toHaveText('bdd-chat');
  await page.getByRole('button', { name: '关闭模型面板' }).click();
  await page.getByRole('button', { name: '打开模型面板' }).click();
  await expect(page.getByTestId('checks')).toHaveText('2');
});

test('Given a panel check fails, Then the old models remain and retry uses the same controller', async ({
  page,
}) => {
  const initial = await api.modelCatalog.check.query();
  const name =
    initial.models.find((model: any) => model.id === 'bdd-chat').displayName ?? 'bdd-chat';
  await page.clock.install();
  await page.goto('http://127.0.0.1:19329/refresh-harness.html');
  await page.clock.runFor(1001);
  await expect(page.getByTestId('checks')).toHaveText('1');
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.clock.runFor(2 * 60_000 + 1);
  let blocked = false;
  await page.route('**/trpc/lambda/**', async (route) => {
    if (!blocked && route.request().url().includes('modelCatalog.check')) {
      blocked = true;
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: '打开模型面板' }).click();
  const panel = page.getByTestId('model-panel');
  await expect(panel).toContainText(name);
  await expect(page.getByRole('button', { name: '模型信息暂未更新 · 重试' })).toBeVisible();
  await expect(page.getByTestId('checks')).toHaveText('2');
  await page.getByRole('button', { name: '模型信息暂未更新 · 重试' }).click();
  await expect(page.getByTestId('checks')).toHaveText('3');
  await expect(page.getByRole('button', { name: '模型信息暂未更新 · 重试' })).toHaveCount(0);
  await expect(panel).toContainText(name);
});

test('Given an unauthenticated caller, Then catalog reads and writes are rejected', async () => {
  const anonymous = createTRPCClient<any>({
    links: [
      httpBatchLink({
        url: `${backend}/trpc/lambda`,
        transformer: superjson,
        headers: { 'x-bdd-anonymous': '1' },
      }),
    ],
  });
  await expect(anonymous.modelCatalog.list.query()).rejects.toMatchObject({
    data: { code: 'UNAUTHORIZED' },
  });
  await expect(
    anonymous.modelCatalog.updateSettings.mutate({ enabled: true, silentRefreshEnabled: true }),
  ).rejects.toMatchObject({
    data: { code: 'UNAUTHORIZED' },
  });
});

test('Given a background or offline app, Then timer checks pause and an overdue resume checks once', async ({
  page,
  context,
}) => {
  await page.clock.install();
  await page.goto('http://127.0.0.1:19329/refresh-harness.html');
  await page.clock.runFor(1001);
  await expect(page.getByTestId('checks')).toHaveText('1');
  await page.evaluate(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }),
  );
  await page.clock.runFor(30 * 60_000);
  await expect(page.getByTestId('checks')).toHaveText('1');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('checks')).toHaveText('2');
  await context.setOffline(true);
  await page.clock.runFor(30 * 60_000);
  await expect(page.getByTestId('checks')).toHaveText('2');
  await context.setOffline(false);
  await expect(page.getByTestId('checks')).toHaveText('3');
});

test('Given revoked access, Then the next real call is rejected and a refreshed empty directory has no builtin fallback', async ({
  request,
}) => {
  expect(
    (await request.post(`${backend}/bdd/call`, { data: { model: 'bdd-chat' } })).status(),
  ).toBe(200);
  await request.post(`${backend}/bdd/state`, { data: { accessible: [] } });
  expect(
    (await request.post(`${backend}/bdd/call`, { data: { model: 'bdd-chat' } })).status(),
  ).toBe(403);
  const settings = (await api.modelCatalog.list.query()).settings;
  await api.modelCatalog.updateSettings.mutate({
    enabled: settings.enabled,
    silentRefreshEnabled: true,
  });
  const empty = await api.modelCatalog.check.query();
  expect(empty.status).toBe('changed');
  expect(empty.models).toEqual([]);
  await request.post(`${backend}/bdd/state`, { data: { accessible: ['bdd-chat', 'bdd-vision'] } });
  await api.modelCatalog.updateSettings.mutate({ enabled: true, silentRefreshEnabled: true });
});

test('Given a warmed snapshot, Then repeated version probes do not read Aihub or provision credentials', async ({
  request,
}) => {
  const snapshot = await api.modelCatalog.check.query();
  const before = (await (await request.get(`${backend}/bdd/state`)).json()).calls.length;
  const started = Date.now();
  for (let i = 0; i < 100; i++)
    expect((await api.modelCatalog.check.query({ knownRevision: snapshot.revision })).status).toBe(
      'unchanged',
    );
  const after = await (await request.get(`${backend}/bdd/state`)).json();
  expect(after.calls.length).toBe(before);
  expect(after.calls.every((call: any) => call.method === 'GET')).toBe(true);
  console.log(`100 cached HTTP probes: ${Date.now() - started}ms; additional Aihub reads: 0`);
});

test('Given a bridge outage, Then the prior directory remains available as stale without changing publication', async ({
  request,
}) => {
  const snapshot = await api.modelCatalog.check.query();
  await request.post(`${backend}/bdd/state`, { data: { bridgeOffline: true } });
  await api.modelCatalog.updateSettings.mutate({ enabled: true, silentRefreshEnabled: true });
  const result = await api.modelCatalog.check.query();
  expect(result.status).toBe('changed');
  expect(result.stale).toBe(true);
  expect(result.models.map((model: any) => model.id)).toEqual(
    snapshot.models.map((model: any) => model.id),
  );
  expect(result.models[0].settings.aihubPricing.stale).toBe(true);
  await request.post(`${backend}/bdd/state`, { data: { bridgeOffline: false } });
});

test('Given an ordinary member, Then model maintenance is forbidden', async () => {
  const member = createTRPCClient<any>({
    links: [
      httpBatchLink({
        url: `${backend}/trpc/lambda`,
        transformer: superjson,
        headers: { 'x-bdd-member': '1' },
      }),
    ],
  });
  await expect(member.modelCatalog.list.query()).rejects.toMatchObject({
    data: { code: 'FORBIDDEN' },
  });
});
