import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer } from '../src/server.mjs';
let service, directory, client;
const article =
  '当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行、采取补救措施或者赔偿损失等违约责任。';
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'masterino-law-test-'));
  await mkdir(join(directory, 'laws'));
  await writeFile(
    join(directory, 'laws/index.json'),
    JSON.stringify([{ slug: 'civil-code', title: '中华人民共和国民法典', articleCount: 1260 }]),
  );
  await writeFile(
    join(directory, 'laws/civil-code.json'),
    JSON.stringify({
      title: '中华人民共和国民法典',
      status: 'effective',
      effectiveDate: '2021-01-01',
      source: 'https://flk.npc.gov.cn/',
      articles: [{ articleNumber: 577, displayNumber: '第五百七十七条', text: article }],
    }),
  );
  service = await startServer({
    dataDirectory: directory,
    port: 0,
    host: '127.0.0.1',
    dataVersion: 'fixture',
  });
  client = new Client({ name: 'acceptance', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${service.address().port}/mcp`)),
  );
});
after(async () => {
  await client?.close();
  await service?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('Given HTTP MCP, initialization discovers exactly the three published law tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'get_article',
    'search_in_law',
    'search_laws',
  ]);
});
test('Given civil code, protocol returns article 577 verbatim with provenance', async () => {
  const r = await client.callTool({
    name: 'get_article',
    arguments: { law: '民法典', article_number: 577 },
  });
  assert.equal(r.isError, undefined);
  const t = r.content[0].text;
  for (const x of [article, '2021-01-01', 'fixture', 'https://flk.npc.gov.cn/'])
    assert.ok(t.includes(x));
});

test('Given a law name and keywords, callers find a law and retrieve its matching clause', async () => {
  const a = await client.callTool({
    name: 'search_laws',
    arguments: { query: '中华人民共和国民法典' },
  });
  assert.ok(a.content[0].text.includes('civil-code'));
  const b = await client.callTool({
    name: 'search_in_law',
    arguments: { law: 'civil-code', keywords: '违约责任' },
  });
  assert.ok(b.content[0].text.includes('第五百七十七条'));
});
test('Given a missing law or article, no text is invented and later valid calls still succeed', async () => {
  for (const args of [
    { law: '不存在的法律XYZ', article_number: 577 },
    { law: '民法典', article_number: 999999 },
  ]) {
    const r = await client.callTool({ name: 'get_article', arguments: args });
    assert.match(r.content[0].text, /未找到|未收录/);
    assert.ok(!r.content[0].text.includes(article));
  }
  const invalid = await client.callTool({
    name: 'get_article',
    arguments: { law: '民法典', article_number: -1 },
  });
  assert.equal(invalid.isError, true);
  const valid = await client.callTool({
    name: 'get_article',
    arguments: { law: '民法典', article_number: 577 },
  });
  assert.ok(valid.content[0].text.includes(article));
});
test('Given separate clients and concurrent calls, each receives the requested result', async () => {
  const other = new Client({ name: 'other', version: '1.0.0' });
  await other.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${service.address().port}/mcp`)),
  );
  try {
    const requests = Array.from({ length: 12 }, (_, i) => ({
      client: i % 2 ? client : other,
      args: { law: '民法典', article_number: i % 2 ? 577 : 888 },
    }));
    const responses = await Promise.all(
      requests.map(({ client, args }) => client.callTool({ name: 'get_article', arguments: args })),
    );
    responses.forEach((r, i) =>
      assert.ok(r.content[0].text.includes(i % 2 ? article : '未收录第 888 条')),
    );
  } finally {
    await other.close();
  }
});
test('Given non-MCP paths or unsupported GET, server returns clear HTTP status', async () => {
  const base = `http://127.0.0.1:${service.address().port}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
});
