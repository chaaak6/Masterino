import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { rank, excerpt, loadCases } from './search.mjs';

export async function startServer({ dataDirectory, dataVersion, port = 3230, host = '0.0.0.0' }) {
  const index = JSON.parse(await readFile(join(dataDirectory, 'laws/index.json'), 'utf8'));
  if (!Array.isArray(index) || !index.length) throw new Error('Law index is empty');
  const cache = new Map();
  const normalize = (value) => value.replace(/^中华人民共和国/, '');
  const resolveLaw = (value) =>
    index.find((l) => l.slug === value || l.title === value) ||
    index.find((l) => normalize(l.title) === normalize(value));
  async function loadLaw(meta) {
    // Only indexed slugs are used as file paths.
    if (!cache.has(meta.slug))
      cache.set(
        meta.slug,
        JSON.parse(await readFile(join(dataDirectory, 'laws', `${meta.slug}.json`), 'utf8')),
      );
    return cache.get(meta.slug);
  }
  const reply = (text, slug) => ({
    content: [
      {
        type: 'text',
        text: [
          text,
          `数据版本：${dataVersion}`,
          `语料来源：https://github.com/lttxzmj/chinese-law-corpus/blob/${dataVersion}/laws/${slug ? `${slug}.json` : 'index.json'}`,
          '非官方整理；正式引用请以官方公布文本为准。官方核验入口：https://flk.npc.gov.cn/',
        ].join('\n'),
      },
    ],
  });
  let articleRows;
  const articles = () =>
    (articleRows ??= Promise.all(
      index.map(async (meta) => {
        const law = await loadLaw(meta);
        return law.articles.map((article) => ({
          ...article,
          law: law.title,
          category: law.category,
          slug: meta.slug,
        }));
      }),
    ).then((rows) => rows.flat()));
  let caseRows;
  const cases = () => (caseRows ??= loadCases(dataDirectory));
  const makeMcp = () => {
    const mcp = new McpServer(
      { name: 'masterino-chinese-law', version: '1.0.0' },
      { maxToolInputElements: 16 },
    );
    mcp.tool(
      'search_laws',
      '按名称或简称查找已收录的中国法规。返回目录与条文数量，不是自然语言语义检索。',
      { query: z.string().trim().min(1) },
      async ({ query }) => {
        console.info(JSON.stringify({ event: 'tool-call', tool: 'search_laws' }));
        const matches = index.filter((l) => l.title.includes(normalize(query) || query));
        const hits = matches.slice(0, 20);
        return reply(
          hits.length
            ? hits.map((l) => `${l.title}（id: ${l.slug}，${l.articleCount} 条）`).join('\n') +
                (matches.length > hits.length
                  ? `\n共 ${matches.length} 条匹配，仅显示前 20 条，请使用更精确的名称。`
                  : '')
            : `未找到包含「${query}」的已收录法规。`,
        );
      },
    );
    mcp.tool(
      'get_article',
      '按法规名称或 id 和阿拉伯数字条号查询原文，附数据版本。用于已知条文核对，不提供历史时点版本推断。',
      { law: z.string().trim().min(1), article_number: z.number().int().positive() },
      async ({ law, article_number }) => {
        console.info(JSON.stringify({ event: 'tool-call', tool: 'get_article' }));
        const meta = resolveLaw(law);
        if (!meta) return reply(`未找到法规「${law}」，请先用 search_laws 查询。`);
        const full = await loadLaw(meta);
        const a = full.articles.find((a) => a.articleNumber === article_number);
        if (!a) return reply(`《${full.title}》未收录第 ${article_number} 条。`, meta.slug);
        return reply(
          [
            `《${full.title}》${a.displayNumber}`,
            a.path?.join(' · '),
            a.text,
            `效力状态：${full.status ?? '未标注'}；施行日期：${full.effectiveDate ?? '未标注'}`,
          ]
            .filter(Boolean)
            .join('\n'),
          meta.slug,
        );
      },
    );
    mcp.tool(
      'search_in_law',
      '在指定法规中按关键词检索条文，空格分隔关键词，返回最多十条摘录；需要全文时再调用 get_article。',
      { law: z.string().trim().min(1), keywords: z.string().trim().min(1) },
      async ({ law, keywords }) => {
        console.info(JSON.stringify({ event: 'tool-call', tool: 'search_in_law' }));
        const meta = resolveLaw(law);
        if (!meta) return reply(`未找到法规「${law}」，请先用 search_laws 查询。`);
        const full = await loadLaw(meta);
        const terms = keywords.split(/\s+/);
        const hits = full.articles
          .map((a) => ({ a, score: terms.filter((t) => a.text.includes(t)).length }))
          .filter((x) => x.score)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);
        return reply(
          hits.length
            ? `《${full.title}》关键词检索摘录（最多 10 条，完整引用请调用 get_article）：\n` +
                hits
                  .map(({ a }) => {
                    const at = a.text.indexOf(terms.find((t) => a.text.includes(t)));
                    const start = Math.max(0, at - 20),
                      end = at + 160;
                    return `${a.displayNumber}：${start ? '…' : ''}${a.text.slice(start, end)}${end < a.text.length ? '…' : ''}`;
                  })
                  .join('\n')
            : `《${full.title}》未检索到「${keywords}」。`,
          meta.slug,
        );
      },
    );
    mcp.tool(
      'search_articles',
      '跨法规全文关键词检索；无需先知道法规名。支持常用用语扩展，不是语义推理。返回条号和摘录，正式引用请再用 get_article 获取全文。',
      {
        query: z.string().trim().min(1).max(200),
        law: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(20).default(10),
      },
      async ({ query, law, limit }) => {
        console.info(JSON.stringify({ event: 'tool-call', tool: 'search_articles' }));
        const meta = law ? resolveLaw(law) : undefined;
        if (law && !meta) return reply(`未找到法规「${law}」，请先用 search_laws 查询。`);
        const rows = (await articles()).filter((row) => !meta || row.slug === meta.slug);
        const hits = rank(rows, query, (row) => `${row.law}\n${row.text}`);
        return reply(
          hits.length
            ? `共 ${hits.length} 条匹配，显示前 ${Math.min(limit, hits.length)} 条摘录：\n` +
                hits
                  .slice(0, limit)
                  .map(
                    ({ row, term }) =>
                      `《${row.law}》${row.displayNumber}（id: ${row.slug}，article_number: ${row.articleNumber}）\n${excerpt(row.text, term)}\n语料来源：https://github.com/lttxzmj/chinese-law-corpus/blob/${dataVersion}/laws/${row.slug}.json`,
                  )
                  .join('\n\n')
            : `未检索到「${query}」的相关条文。`,
        );
      },
    );
    mcp.tool(
      'search_cases',
      '检索本地快照的指导性案例和最高法公报案例（不是全国裁判文书库），按标题、关键词、裁判理由和正文匹配；返回案例 id、摘录、官方来源，用 get_case 获取详情。',
      {
        query: z.string().trim().min(1).max(200),
        kind: z.enum(['all', 'guiding', 'gazette']).default('all'),
        limit: z.number().int().min(1).max(20).default(5),
      },
      async ({ query, kind, limit }) => {
        console.info(JSON.stringify({ event: 'tool-call', tool: 'search_cases' }));
        const rows = (await cases()).filter(
          (row) => kind === 'all' || row.kind === `${kind}-cases`,
        );
        const hits = rank(rows, query, (row) => row.text);
        const text = hits.length
          ? `共 ${hits.length} 条匹配，显示前 ${Math.min(limit, hits.length)} 条：\n` +
            hits
              .slice(0, limit)
              .map(
                ({ row, term }) =>
                  `${row.kind === 'guiding-cases' ? '指导性案例' : '公报案例'}：${row.title}（id: ${row.id}）\n${excerpt(row.text, term)}\n官方来源：${row.sourceUrl}\n语料来源：https://github.com/lttxzmj/chinese-law-corpus/blob/${dataVersion}/${row.kind}/${row.id}.json`,
              )
              .join('\n\n')
          : `未检索到「${query}」的案例。`;
        return {
          content: [
            {
              type: 'text',
              text: `${text}\n范围：仅本地指导性案例和公报案例，不是全国案例库，也不包含企业信用信息。\n数据版本：${dataVersion}\n非官方整理；正式引用请核对上述官方来源。`,
            },
          ],
        };
      },
    );
    mcp.tool(
      'get_case',
      '按 search_cases 返回的 id 获取本地案例详情（案情、裁判要点、理由、结果或公报正文）。长正文按字符 offset/limit 分页，按提示继续读取；附官方来源及语料版本。',
      {
        id: z.string().trim().min(1).max(100),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(100).max(12000).default(6000),
      },
      async ({ id, offset, limit }) => {
        console.info(JSON.stringify({ event: 'tool-call', tool: 'get_case' }));
        const row = (await cases()).find((doc) => doc.id === id);
        if (!row)
          return {
            content: [
              { type: 'text', text: `未找到案例「${id}」，请先用 search_cases 查询本地案例 id。` },
            ],
          };
        const sections = {
          title: '标题',
          caseNumber: '案号',
          court: '法院',
          keywords: '关键词',
          gist: '裁判要点',
          facts: '基本案情',
          result: '裁判结果',
          reasoning: '裁判理由',
          body: '正文',
        };
        const text = Object.entries(sections)
          .filter(([key]) => row[key]?.length)
          .map(
            ([key, label]) =>
              `${label}：\n${Array.isArray(row[key]) ? row[key].join('\n') : row[key]}`,
          )
          .join('\n\n');
        const end = Math.min(offset + limit, text.length);
        return {
          content: [
            {
              type: 'text',
              text: [
                `${row.kind === 'guiding-cases' ? '指导性案例' : '公报案例'}：${row.title}（id: ${row.id}）`,
                text.slice(offset, end),
                `正文字符范围：${offset}-${end}/${text.length}。${end < text.length ? `已截断，下一页 offset: ${end}，limit: ${limit}。` : '已到末尾。'}`,
                `官方来源：${row.sourceUrl}`,
                `语料来源：https://github.com/lttxzmj/chinese-law-corpus/blob/${dataVersion}/${row.kind}/${row.id}.json`,
                `数据版本：${dataVersion}`,
                '非官方整理；正式引用请核对官方来源。',
              ].join('\n'),
            },
          ],
        };
      },
    );
    return mcp;
  };
  const http = createServer(async (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', dataVersion, laws: index.length }));
      return;
    }
    if (req.url !== '/mcp') {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    const mcp = makeMcp();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 16 * 1024,
    });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    const started = Date.now();
    res.on('finish', () =>
      console.info(
        JSON.stringify({
          event: 'mcp-request',
          status: res.statusCode,
          durationMs: Date.now() - started,
        }),
      ),
    );
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('MCP request failed', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'MCP request failed' }));
      }
    }
  });
  await new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, host, resolve);
  });
  return {
    address: () => http.address(),
    close: () => new Promise((resolve, reject) => http.close((e) => (e ? reject(e) : resolve()))),
  };
}
