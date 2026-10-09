import { Given, When, Then, setDefaultTimeout } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';

setDefaultTimeout(120_000);
const base = process.env.ADMIN_ACCEPTANCE_URL || 'https://admin-mlai-test.bielcrystal.com';
const creds = JSON.parse(fs.readFileSync(process.env.ADMIN_ACCEPTANCE_CREDENTIALS!, 'utf8'));
const run = Date.now();
let cookie = '';
let employeeCookie = '';
let identifier = '';
let kind = 'mcp';
let response: any;
let tools: any[] = [];
let invalidArchive = zipSync({ 'README.md': strToU8('missing skill') });
const sessions = new Map<string, string>();
async function login(email: string) {
  if (sessions.has(email)) return sessions.get(email)!;
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': base },
    body: JSON.stringify({ email, password: creds.password }),
  });
  assert.equal(res.status, 200, `Login failed: ${await res.clone().text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  sessions.set(email, cookie);
  return cookie;
}
async function rpc(path: string, input: any, auth = cookie, method = 'POST', prefix = 'lambda') {
  const url =
    `${base}/trpc/${prefix}/${path}` +
    (method === 'GET' ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : '');
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'Cookie': auth, 'Origin': base },
    ...(method === 'POST' ? { body: JSON.stringify({ json: input }) } : {}),
  });
  const body = await res.text();
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`${path}: HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  if (!res.ok || data.error) throw new Error(JSON.stringify(data));
  return data.result.data.json;
}
Given('an administrator imports a Streamable HTTP mcpServers configuration', async () => {
  cookie = await login(creds.admin);
  employeeCookie = await login(creds.employee);
  identifier = `bdd-mcp-${run}`;
  kind = 'mcp';
});
When(
  'connection verification discovers tools and the administrator submits the resource',
  async () => {
    const connection = {
      url: process.env.ADMIN_ACCEPTANCE_MCP_URL || 'https://learn.microsoft.com/api/mcp',
      headers: process.env.ADMIN_ACCEPTANCE_MCP_KEY
        ? { Authorization: `Bearer ${process.env.ADMIN_ACCEPTANCE_MCP_KEY}` }
        : {},
    };
    const verified = await rpc('admin.verifyCatalogMcp', connection);
    tools = verified.tools;
    assert.ok(tools.length);
    response = await rpc('admin.createCatalogResource', {
      type: 'mcp',
      identifier,
      name: 'BDD remote MCP',
      description: 'Disposable acceptance resource',
      version: '1.0.0',
      connection,
    });
    assert.equal(response.workflowState, 'submitted');
  },
);
When('the resource is approved and published', async () => {
  for (const action of ['scan-start', 'scan-passed', 'approve', 'publish'])
    await rpc('admin.reviewMarketResource', { type: kind, identifier, action });
});
Then('another employee can install it from the community without entering an API key', async () => {
  const detail = await rpc('market.getMcpDetail', { identifier }, employeeCookie, 'GET');
  assert.equal(detail.haveCloudEndpoint, 'internal');
  const manifest = await rpc('market.getMcpManifest', { identifier }, employeeCookie, 'GET');
  await rpc(
    'plugin.createOrInstallPlugin',
    {
      identifier,
      type: 'plugin',
      manifest: {
        api: manifest.tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
        identifier,
        meta: { title: 'BDD MCP' },
        type: 'mcp',
      },
      settings: {},
      customParams: { mcp: { type: 'cloud', cloudEndPoint: 'internal' } },
    },
    employeeCookie,
  );
});
Then('the employee can call a discovered tool', async () => {
  const tool =
    tools.find((t) => t.name === 'microsoft_docs_search') ||
    tools.find((t) => t.name === 'yuandian_get_user_balance') ||
    tools.find((t) => t.name === 'company_key_probe');
  assert.ok(tool);
  const result = await rpc(
    'market.callCloudMcpEndpoint',
    {
      identifier,
      toolName: tool.name,
      apiParams: tool.name === 'microsoft_docs_search' ? { query: 'Model Context Protocol' } : {},
    },
    employeeCookie,
    'POST',
    'tools',
  );
  assert.equal(result.success, true);
  assert.ok(result.state.content.length);
  assert.ok(!result.state.isError);
});
Then('the shared credential is absent from community responses', async () => {
  const detail = await rpc('market.getMcpDetail', { identifier }, employeeCookie, 'GET');
  assert.ok(!JSON.stringify(detail).includes('sharedConnection'));
  if (process.env.ADMIN_ACCEPTANCE_MCP_KEY)
    assert.ok(!JSON.stringify(detail).includes(process.env.ADMIN_ACCEPTANCE_MCP_KEY));
});
Given('an administrator uploads a ZIP containing SKILL.md', async () => {
  cookie = await login(creds.admin);
  employeeCookie = await login(creds.employee);
  kind = 'skill';
  identifier = `bdd-skill-${run}`;
});
When('the administrator submits and publishes the Skill', async () => {
  const archive = Buffer.from(
    zipSync({
      'SKILL.md': strToU8(
        `---\nname: ${identifier}\ndescription: BDD acceptance\n---\nReturn BDD_SKILL_OK.`,
      ),
    }),
  ).toString('base64');
  await rpc('admin.createCatalogResource', {
    type: 'skill',
    identifier,
    name: 'BDD Skill',
    description: 'Disposable acceptance Skill',
    version: '1.0.0',
    artifactBase64: archive,
  });
  for (const action of ['scan-start', 'scan-passed', 'approve', 'publish'])
    await rpc('admin.reviewMarketResource', { type: 'skill', identifier, action });
});
Then('another employee can discover and download the Skill archive', async () => {
  const detail = await rpc('market.skill.getSkillDetail', { identifier }, employeeCookie, 'GET');
  assert.equal(detail.identifier, identifier);
  const res = await fetch(`${base}/api/market/skills/${identifier}/download`, {
    headers: { Cookie: employeeCookie },
    redirect: 'follow',
  });
  assert.equal(res.status, 200);
  assert.ok((await res.arrayBuffer()).byteLength > 0);
});
Given('a malformed MCP configuration or a ZIP without SKILL.md', async () => {
  cookie = await login(creds.admin);
  identifier = `bdd-invalid-${run}`;
  invalidArchive = zipSync({ 'README.md': strToU8('missing skill') });
});
When('an administrator submits it', async () => {
  try {
    await rpc('admin.createCatalogResource', {
      type: 'skill',
      identifier,
      name: 'Invalid',
      version: '1.0.0',
      artifactBase64: Buffer.from(invalidArchive).toString('base64'),
    });
    response = 'unexpected-success';
  } catch (e) {
    response = String(e);
  }
});
Then('a readable validation error is displayed', () => {
  assert.ok(response.includes('SKILL.md'));
});
Then('no community resource is published', async () => {
  const list = await rpc(
    'admin.listCatalogResources',
    { type: 'skill', q: identifier, page: 1, pageSize: 20 },
    cookie,
    'GET',
  );
  assert.equal(list.totalCount, 0);
});

Then('the employee can install the Skill and read its content', async () => {
  const installed = await rpc('agentSkills.importFromMarket', { identifier }, employeeCookie);
  assert.ok(installed);
  const skill = await rpc('agentSkills.getByIdentifier', { identifier }, employeeCookie, 'GET');
  assert.ok(skill.content.includes('BDD_SKILL_OK'));
});

Given('a Skill ZIP with invalid frontmatter', async () => {
  cookie = await login(creds.admin);
  identifier = `bdd-invalid-frontmatter-${run}`;
  invalidArchive = zipSync({ 'SKILL.md': strToU8('Body without required frontmatter') });
});
Then('a readable Skill manifest error is displayed', () => {
  assert.ok(response.includes('Invalid skill manifest'));
});
