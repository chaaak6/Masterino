import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer } from '../src/server.mjs';
let directory, service, client;
const write = (path, value) => writeFile(join(directory, path), JSON.stringify(value));
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'law-search-'));
  for (const folder of ['laws', 'guiding-cases', 'gazette-cases'])
    await mkdir(join(directory, folder));
  await write('laws/index.json', [
    { slug: 'labor-law', title: '中华人民共和国劳动法', articleCount: 2 },
    { slug: 'labor-contract-law', title: '中华人民共和国劳动合同法', articleCount: 1 },
    { slug: 'crew-rule', title: '船员工资司法解释', articleCount: 1 },
  ]);
  await write('laws/crew-rule.json', {
    title: '船员工资司法解释',
    category: '司法解释',
    articles: [{ articleNumber: 8, displayNumber: '第八条', text: '船员加班工资属于劳动报酬。' }],
  });
  await write('laws/labor-law.json', {
    title: '中华人民共和国劳动法',
    category: '法律',
    articles: [
      {
        articleNumber: 44,
        displayNumber: '第四十四条',
        text: '安排劳动者延长工作时间的，支付不低于工资的百分之一百五十的工资报酬。',
      },
      {
        articleNumber: 41,
        displayNumber: '第四十一条',
        text: '用人单位由于生产经营需要，可以延长工作时间。',
      },
    ],
  });
  await write('laws/labor-contract-law.json', {
    title: '中华人民共和国劳动合同法',
    articles: [
      {
        articleNumber: 31,
        displayNumber: '第三十一条',
        text: '用人单位安排加班的，应当支付加班费。',
      },
    ],
  });
  await write('guiding-cases/guiding-182.json', {
    id: 'guiding-182',
    title: '劳动报酬奖金纠纷案',
    keywords: ['劳动报酬', '奖金'],
    facts: ['劳动者完成工作。'],
    gist: ['符合奖励条件的应发放奖金。'],
    reasoning: ['公司应履行审批义务。'],
    result: ['支付奖金。'],
    sourceUrl: 'https://www.court.gov.cn/example',
  });
  await write('gazette-cases/gazette-test.json', {
    id: 'gazette-test',
    title: '劳动报酬争议案',
    body: '劳动报酬与奖金争议。'.repeat(150),
    caseNumber: '测试案号',
    court: '测试法院',
    sourceUrl: 'https://gongbao.court.gov.cn/example',
  });
  service = await startServer({
    dataDirectory: directory,
    dataVersion: 'fixture',
    host: '127.0.0.1',
    port: 0,
  });
  client = new Client({ name: 'search-acceptance', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${service.address().port}/mcp`)),
  );
});
after(async () => {
  await client?.close();
  await service?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const call = async (name, args) =>
  (await client.callTool({ name, arguments: args })).content[0].text;
test('Given no law name, full-text search finds relevant clauses across laws with provenance', async () => {
  const text = await call('search_articles', { query: '加班工资' });
  assert.match(text, /劳动法/);
  assert.match(text, /第四十四条/);
  assert.ok(text.indexOf('第四十四条') < text.indexOf('船员工资司法解释'));
  assert.match(text, /劳动合同法/);
  assert.match(text, /fixture/);
  assert.match(text, /https:\/\/flk.npc.gov.cn/);
});
test('Given a law filter and result limit, full-text results stay scoped and disclose truncation', async () => {
  const text = await call('search_articles', { query: '延长工作时间', law: '劳动法', limit: 1 });
  assert.match(text, /共 2 条匹配，显示前 1 条/);
  assert.ok(!text.includes('劳动合同法'));
  assert.match(await call('search_articles', { query: '工资', law: '不存在的法律' }), /未找到法规/);
});
test('Given a keyword, callers search both case collections and can restrict case type', async () => {
  const text = await call('search_cases', { query: '劳动报酬 奖金' });
  assert.match(text, /guiding-182/);
  assert.match(text, /gazette-test/);
  assert.match(text, /www.court.gov.cn/);
  assert.match(text, /不是全国/);
  const guiding = await call('search_cases', { query: '奖金', kind: 'guiding' });
  assert.match(guiding, /guiding-182/);
  assert.ok(!guiding.includes('gazette-test'));
});
test('Given a case id, detail preserves judicial sections and official source, with explicit pagination', async () => {
  const text = await call('get_case', { id: 'guiding-182' });
  for (const expected of [
    '劳动者完成工作。',
    '符合奖励条件的应发放奖金。',
    '公司应履行审批义务。',
    '支付奖金。',
    'https://www.court.gov.cn/example',
    'fixture',
  ])
    assert.ok(text.includes(expected));
  const page = await call('get_case', { id: 'gazette-test', limit: 300 });
  assert.match(page, /下一页 offset: 300/);
  const next = await call('get_case', { id: 'gazette-test', offset: 300, limit: 300 });
  assert.match(next, /offset: 600/);
  assert.match(await call('get_case', { id: '../laws/civil-code' }), /未找到案例/);
});
test('Given missing results or invalid input, search recovers and concurrent calls stay independent', async () => {
  assert.match(await call('search_articles', { query: '不存在的量子法规XYZ' }), /未检索到/);
  assert.match(await call('search_cases', { query: '不存在的量子法规XYZ' }), /未检索到/);
  for (const name of ['search_articles', 'search_cases']) {
    const bad = await client.callTool({ name, arguments: { query: '   ' } });
    assert.equal(bad.isError, true);
  }
  const [law, cases] = await Promise.all([
    call('search_articles', { query: '延长工作时间', law: '劳动法' }),
    call('search_cases', { query: '奖金', kind: 'gazette', limit: 1 }),
  ]);
  assert.match(law, /第四十四条/);
  assert.match(cases, /gazette-test/);
  assert.ok(!cases.includes('guiding-182'));
});
