import { Given, When, Then, BeforeAll, AfterAll, setDefaultTimeout } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';

setDefaultTimeout(120_000);
const root = path.resolve('..');
const prefix = `bdd-cli-${Date.now()}`;
let folder: string;
let batch: string;
let base: string;
let key: string;
let output: { code: number; text: string; data: any };
const submitted: Array<{ identifier: string; type: 'mcp' | 'skill' }> = [];
async function rpc(name: string, input: any) {
  const res = await fetch(
    `${base}/trpc/lambda/${name}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
    { headers: { 'X-API-Key': key } },
  );
  assert.equal(res.status, 200);
  return (await res.json()).result.data.json;
}
async function cli(args: string[], credential = key) {
  const child = spawn(
    process.execPath,
    [path.join(root, 'apps/cli/dist/index.js'), 'community', 'import', ...args, '--json'],
    {
      env: {
        ...process.env,
        LOBEHUB_SERVER: base,
        LOBEHUB_CLI_API_KEY: credential,
        LOBEHUB_JWT: '',
      },
    },
  );
  let text = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (text += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
  assert.ok(!text.includes(credential) && !stderr.includes(credential));
  return { code, text, data: JSON.parse(text) };
}
async function skill(name: string) {
  const dir = path.join(folder, name);
  await fs.mkdir(path.join(dir, 'references'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: CLI BDD acceptance\n---\nRead references/guide.md.`,
  );
  await fs.writeFile(path.join(dir, 'references/guide.md'), 'CLI_RESOURCE_OK');
  return name;
}
BeforeAll(async () => {
  const env = await fs.readFile(process.env.COMMUNITY_CLI_CREDENTIALS!, 'utf8');
  base = /^export LOBEHUB_SERVER=(.+)$/m.exec(env)![1];
  key = /^export LOBEHUB_CLI_API_KEY=(.+)$/m.exec(env)![1];
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'masterino-community-bdd-'));
  await fs.writeFile(
    path.join(folder, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        [`${prefix}-mcp`]: { type: 'http', url: 'https://learn.microsoft.com/api/mcp' },
      },
    }),
  );
  await skill(`${prefix}-skill`);
  batch = path.join(folder, 'batch.json');
  await fs.writeFile(
    batch,
    JSON.stringify({
      resources: [
        { type: 'mcp', path: 'mcp.json' },
        { type: 'skill', path: `${prefix}-skill` },
      ],
    }),
  );
});
Given('local MCP JSON and a Skill directory', () => {});
When('the built CLI previews the batch', async () => {
  output = await cli(['batch', batch, '--dry-run']);
});
Then('both resources are prepared without creating server resources', async () => {
  assert.equal(output.code, 0);
  assert.deepEqual(
    output.data.results.map((item: any) => item.status),
    ['prepared', 'prepared'],
  );
  for (const type of ['mcp', 'skill']) {
    const list = await rpc('admin.listCatalogResources', {
      type,
      q: prefix,
      page: 1,
      pageSize: 100,
    });
    assert.equal(list.totalCount, 0);
  }
});
When('the built CLI submits the batch with an administrator API Key', async () => {
  output = await cli(['batch', batch]);
  for (const item of output.data.results)
    if (item.status === 'submitted')
      submitted.push({
        identifier: item.identifier,
        type: item.identifier.endsWith('-mcp') ? 'mcp' : 'skill',
      });
});
Then(
  'both resources are submitted and invisible to community users until publication',
  async () => {
    assert.equal(output.code, 0);
    assert.equal(output.data.submitted, 2);
    for (const type of ['mcp', 'skill']) {
      const list = await rpc('admin.listCatalogResources', {
        type,
        q: prefix,
        page: 1,
        pageSize: 100,
      });
      assert.equal(list.items.length, 1);
      assert.equal(list.items[0].workflowState, 'submitted');
      assert.equal(list.items[0].clientVisible, false);
    }
  },
);
Given('a batch with an existing MCP, an invalid Skill ZIP and a new valid Skill', async () => {
  await fs.writeFile(
    path.join(folder, 'invalid.zip'),
    zipSync({ 'README.md': strToU8('no SKILL.md') }),
  );
  await skill(`${prefix}-later-skill`);
  await fs.writeFile(
    path.join(folder, 'mixed.json'),
    JSON.stringify({
      resources: [
        { type: 'mcp', path: 'mcp.json' },
        { type: 'skill', path: 'invalid.zip' },
        { type: 'skill', path: `${prefix}-later-skill` },
      ],
    }),
  );
});
When('the built CLI submits the mixed batch', async () => {
  output = await cli(['batch', path.join(folder, 'mixed.json')]);
  for (const item of output.data.results)
    if (item.status === 'submitted') submitted.push({ identifier: item.identifier, type: 'skill' });
});
Then('it reports two failures and one submission with a nonzero exit code', () => {
  assert.equal(output.code, 1);
  assert.equal(output.data.failed, 2);
  assert.equal(output.data.submitted, 1);
  assert.equal(output.data.results.at(-1).status, 'submitted');
});
When('the built CLI submits with an invalid API Key', async () => {
  output = await cli(['mcp', path.join(folder, 'mcp.json')], 'sk-lh-invalid-community-acceptance');
});
Then('submission fails without printing the credential', () => {
  assert.equal(output.code, 1);
  assert.equal(output.data.failed, 1);
  assert.ok(output.data.results[0].error);
});
AfterAll(async () => {
  // Rejected submissions stay in admin history and never reach community publication.
  for (const item of submitted) {
    for (const action of ['scan-start', 'scan-failed']) {
      const res = await fetch(`${base}/trpc/lambda/admin.reviewMarketResource`, {
        method: 'POST',
        headers: { 'X-API-Key': key, 'Content-Type': 'application/json', 'Origin': base },
        body: JSON.stringify({
          json: {
            ...item,
            action,
            reason: 'CLI BDD acceptance complete; discard disposable test submission',
          },
        }),
      });
      assert.equal(res.status, 200);
    }
  }
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});
