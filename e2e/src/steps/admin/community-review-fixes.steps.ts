import { AfterAll, Given, Then, When, setDefaultTimeout } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

setDefaultTimeout(120_000);
const base = 'https://admin-mlai-test.bielcrystal.com';
const prefix = `bdd-review-${Date.now()}`;
const rollbackId = `${prefix}-rollback`;
const submitted: Array<{ identifier: string; type: 'skill' | 'mcp'; published?: boolean }> = [];
let folder: string;
let key: string;
let cliResult: any;
let response: any;
let faultActive = false;
let selectedTool: any;
async function credentials() {
  if (!key) {
    const env = await fs.readFile(process.env.COMMUNITY_CLI_CREDENTIALS!, 'utf8');
    key = /^export LOBEHUB_CLI_API_KEY=(.+)$/m.exec(env)![1];
  }
}
function control(action: string, identifier?: string) {
  return execFileSync(
    'kubectl',
    [
      '--kubeconfig',
      process.env.COMMUNITY_REVIEW_KUBECONFIG!,
      '-n',
      'masterino-test',
      'exec',
      process.env.COMMUNITY_REVIEW_MARKET_POD!,
      '--',
      'node',
      '/app/dist/bdd-review-control.cjs',
      action,
      ...(identifier ? [identifier] : []),
    ],
    { encoding: 'utf8', timeout: 30_000 },
  ).trim();
}
async function rpc(name: string, input: any, query = false, cookie?: string, prefix = 'lambda') {
  await credentials();
  const encoded = JSON.stringify({ json: input });
  const result = await fetch(
    `${base}/trpc/${prefix}/${name}${query ? `?input=${encodeURIComponent(encoded)}` : ''}`,
    {
      method: query ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': base,
        ...(cookie ? { Cookie: cookie } : { 'X-API-Key': key }),
      },
      ...(!query && { body: encoded }),
    },
  );
  const body = await result.json();
  return { status: result.status, data: body.result?.data?.json, error: body.error?.json?.message };
}
const archive = () =>
  Buffer.from(
    zipSync({
      'SKILL.md': strToU8('---\nname: retryable\ndescription: BDD test\n---\nInstructions'),
    }),
  ).toString('base64');
Given('a disposable Skill directory containing an oversized file', async () => {
  await credentials();
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'community-review-'));
  await fs.writeFile(path.join(folder, 'SKILL.md'), '---\nname: oversized\ndescription: test\n---');
  await fs.writeFile(path.join(folder, 'large.bin'), '');
  await fs.truncate(path.join(folder, 'large.bin'), 26 * 1024 * 1024);
});
When('the built CLI prepares the directory', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve('../apps/cli/dist/index.js'),
      'community',
      'import',
      'skill',
      folder,
      '--dry-run',
      '--json',
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(result.status, 1);
  cliResult = JSON.parse(result.stdout);
});
Then('the CLI rejects it with the unpacked file limit', () => {
  assert.equal(cliResult.failed, 1);
  assert.ok(cliResult.results[0].error.includes('25 MiB'));
});
When('an administrator directly submits a ZIP without required Skill metadata', async () => {
  const token = control('token');
  const result = await fetch(`${process.env.COMMUNITY_REVIEW_MARKET_URL}/api/internal/resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-lobe-trust-token': token },
    body: JSON.stringify({
      type: 'skill',
      resource: {
        identifier: `${prefix}-invalid`,
        name: 'Invalid',
        manifest: { files: [{ path: 'SKILL.md' }] },
      },
      artifactBase64: Buffer.from(
        zipSync({ 'SKILL.md': strToU8('Instructions without frontmatter') }),
      ).toString('base64'),
    }),
  });
  response = { status: result.status, data: await result.json() };
});
Then('Market rejects it without creating a resource or uploading an artifact', async () => {
  assert.equal(response.status, 400);
  assert.ok(response.data.error.includes('SKILL.md'));
  assert.equal(
    (
      await rpc(
        'admin.listCatalogResources',
        { type: 'skill', page: 1, pageSize: 20, q: `${prefix}-invalid` },
        true,
      )
    ).data.totalCount,
    0,
  );
  // Unit tests additionally verify this rejection precedes object upload.
});
Given('version insertion fails only for this disposable submission', () => {
  control('inject', rollbackId);
  faultActive = true;
});
When('an administrator submits its valid Skill ZIP', async () => {
  response = await rpc('admin.createCatalogResource', {
    type: 'skill',
    identifier: rollbackId,
    name: 'Retryable',
    version: '1.0.0',
    artifactBase64: archive(),
  });
});
Then('the failed resource is absent', async () => {
  assert.notEqual(response.status, 200);
  assert.equal(
    (
      await rpc(
        'admin.listCatalogResources',
        { type: 'skill', page: 1, pageSize: 20, q: rollbackId },
        true,
      )
    ).data.totalCount,
    0,
  );
  // Repository tests verify version insertion fails before invoking object upload.
});
When('the injected failure is removed and the same submission is retried', async () => {
  control('remove-fault');
  faultActive = false;
  response = await rpc('admin.createCatalogResource', {
    type: 'skill',
    identifier: rollbackId,
    name: 'Retryable',
    version: '1.0.0',
    artifactBase64: archive(),
  });
  if (response.status === 200) submitted.push({ identifier: rollbackId, type: 'skill' });
});
Then('exactly one submitted resource exists', async () => {
  assert.equal(response.status, 200);
  const result = await rpc(
    'admin.listCatalogResources',
    { type: 'skill', page: 1, pageSize: 20, q: rollbackId },
    true,
  );
  assert.equal(result.data.totalCount, 1);
  assert.equal(result.data.items[0].workflowState, 'submitted');
});
When('an administrator submits and publishes a remote MCP', async () => {
  const identifier = `${prefix}-mcp`;
  const connection = {
    url: process.env.ADMIN_ACCEPTANCE_MCP_URL || 'https://learn.microsoft.com/api/mcp',
    headers: process.env.ADMIN_ACCEPTANCE_MCP_KEY
      ? { Authorization: `Bearer ${process.env.ADMIN_ACCEPTANCE_MCP_KEY}` }
      : {},
  };
  const verified = await rpc('admin.verifyCatalogMcp', connection);
  assert.equal(verified.status, 200);
  selectedTool = verified.data.tools.find(
    (tool: any) => tool.name === 'microsoft_docs_search' || tool.name === 'company_key_probe',
  );
  assert.ok(selectedTool);
  const result = await rpc('admin.createCatalogResource', {
    type: 'mcp',
    identifier,
    name: 'BDD reviewed MCP',
    version: '1.0.0',
    connection,
  });
  assert.equal(result.status, 200);
  const item = { identifier, type: 'mcp' as const, published: false };
  submitted.push(item);
  for (const action of ['scan-start', 'scan-passed', 'approve', 'publish'])
    assert.equal(
      (await rpc('admin.reviewMarketResource', { type: 'mcp', identifier, action })).status,
      200,
    );
  item.published = true;
});
Then('an employee can call its discovered tool without entering a credential', async () => {
  const creds = JSON.parse(await fs.readFile(process.env.ADMIN_ACCEPTANCE_CREDENTIALS!, 'utf8'));
  const login = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': base },
    body: JSON.stringify({ email: creds.employee, password: creds.password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
  const identifier = `${prefix}-mcp`;
  const detail = await rpc('market.getMcpDetail', { identifier }, true, cookie);
  assert.equal(detail.status, 200);
  assert.ok(!JSON.stringify(detail.data).includes('sharedConnection'));
  const result = await rpc(
    'market.callCloudMcpEndpoint',
    {
      identifier,
      toolName: selectedTool.name,
      apiParams:
        selectedTool.name === 'microsoft_docs_search' ? { query: 'Model Context Protocol' } : {},
    },
    false,
    cookie,
    'tools',
  );
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.ok(result.data.state.content.length);
  assert.ok(!result.data.state.isError);
});
AfterAll(async () => {
  if (faultActive) control('remove-fault');
  for (const item of submitted) {
    const actions = item.published ? ['deprecate'] : ['scan-start', 'scan-failed'];
    for (const action of actions)
      assert.equal(
        (
          await rpc('admin.reviewMarketResource', {
            type: item.type,
            identifier: item.identifier,
            action,
            reason: 'Disposable review-fix acceptance complete',
          })
        ).status,
        200,
      );
  }
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});
