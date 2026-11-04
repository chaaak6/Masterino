import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export async function startServer({ dataDirectory, dataVersion, port = 3230, host = '0.0.0.0' }) {
  const index = JSON.parse(await readFile(join(dataDirectory, 'laws/index.json'), 'utf8'));
  if (!Array.isArray(index) || !index.length) throw new Error('Law index is empty');
  const cache = new Map();
  const normalize = (value) => value.replace(/^中华人民共和国/, '');
  const resolveLaw = (value) =>
    index.find((l) => l.slug === value || l.title === value) ||
    index.find((l) => normalize(l.title) === normalize(value)) ||
    index.find((l) => l.title.includes(value));
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
  const makeMcp = () => {
    const mcp = new McpServer({ name: 'masterino-chinese-law', version: '1.0.0' });
    mcp.tool(
      'search_laws',
      '按名称或简称查找已收录的中国法规。返回目录与条文数量，不是自然语言语义检索。',
      { query: z.string().trim().min(1) },
      async ({ query }) => {
        console.info(JSON.stringify({ event: 'tool-call', tool: 'search_laws' }));
        const hits = index.filter((l) => l.title.includes(normalize(query))).slice(0, 20);
        return reply(
          hits.length
            ? hits.map((l) => `${l.title}（id: ${l.slug}，${l.articleCount} 条）`).join('\n')
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
            ? hits
                .map(({ a }) => {
                  const at = a.text.indexOf(terms.find((t) => a.text.includes(t)));
                  return `${a.displayNumber}：${a.text.slice(Math.max(0, at - 20), at + 160)}`;
                })
                .join('\n')
            : `《${full.title}》未检索到「${keywords}」。`,
          meta.slug,
        );
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
