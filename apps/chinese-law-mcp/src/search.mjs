import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const stopwords = new Set([
  '的',
  '了',
  '是',
  '吗',
  '怎么',
  '如何',
  '什么',
  '请',
  '查询',
  '有关',
  '相关',
  '规定',
  '我',
  '能',
  '否',
]);
const aliases = {
  加班: ['延长工作时间'],
  工资: ['劳动报酬'],
  辞退: ['解除劳动合同'],
  欠薪: ['拖欠', '劳动报酬'],
};
const flatten = (value) => (Array.isArray(value) ? value.join('\n') : (value ?? ''));
export const caseText = (doc) =>
  ['title', 'caseNumber', 'court', 'keywords', 'gist', 'facts', 'result', 'reasoning', 'body']
    .map((key) => flatten(doc[key]))
    .filter(Boolean)
    .join('\n');

// Query-time segmentation only: the corpus stays a small local text collection, with no external API/index service.
export function rank(rows, query, textOf) {
  const groups = [
    ...new Set(
      [...segmenter.segment(query)]
        .filter((s) => s.isWordLike && !stopwords.has(s.segment))
        .map((s) => s.segment),
    ),
  ].map((word) => [word, ...(aliases[word] ?? [])]);
  if (!groups.length) return [];
  return rows
    .map((row) => {
      const text = textOf(row);
      const hits = groups.filter((terms) => terms.some((term) => text.includes(term)));
      const score =
        hits.length / groups.length +
        (text.includes(query) ? 0.1 : 0) +
        (row.category === '法律' ? 0.2 : 0);
      const term = hits.flat().find((term) => text.includes(term));
      return { row, score, term };
    })
    .filter((hit) => hit.term)
    .sort((a, b) => b.score - a.score);
}
export function excerpt(text, term, length = 400) {
  const start = Math.max(0, text.indexOf(term) - 60);
  const end = start + length;
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
export async function loadCases(directory) {
  const cases = [];
  for (const kind of ['guiding-cases', 'gazette-cases']) {
    for (const file of (await readdir(join(directory, kind)))
      .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
      .sort()) {
      const doc = JSON.parse(await readFile(join(directory, kind, file), 'utf8'));
      cases.push({ ...doc, kind, text: caseText(doc) });
    }
  }
  return cases;
}
