import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { attr, openOfficeZip, textNodes, unescapeXml } from './zip';

export interface OfficeReadParams {
  aggregateColumn?: string;
  groupByColumn?: string;
  limit?: number;
  maxChars?: number;
  path: string;
  sheet?: string;
  /** One-based row, paragraph, or slide offset. */
  start?: number;
  version?: string;
}
export interface OfficeRecord {
  cells?: { address: string; value: string; formula?: string }[];
  heading?: string;
  index: number;
  text?: string;
}
const versionOf = async (file: string) => {
  const s = await stat(file);
  return `${s.size}:${s.mtimeMs}:${s.ino}`;
};
const integer = (n: number | undefined, fallback: number, max: number) => {
  if (n !== undefined && (!Number.isSafeInteger(n) || n < 1))
    throw new Error('Office range must use positive integers');
  return Math.min(n ?? fallback, max);
};
async function sheetParts(zip: Awaited<ReturnType<typeof openOfficeZip>>) {
  const workbook = await zip.text('xl/workbook.xml');
  const rels = await zip.text('xl/_rels/workbook.xml.rels');
  const relationships = [...rels.matchAll(/<Relationship\s[^>]*>/g)];
  return [...workbook.matchAll(/<sheet\s[^>]*>/g)].map(([xml]) => {
    const rel = relationships.find(([r]) => attr(r, 'Id') === attr(xml, 'r:id'))?.[0] ?? '';
    const target = attr(rel, 'Target');
    return {
      name: attr(xml, 'name'),
      part: target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`),
    };
  });
}
/** Index only the requested prefix on disk; backward references reuse that index. */
async function sharedStrings(zip: Awaited<ReturnType<typeof openOfficeZip>>) {
  if (!zip.entries.has('xl/sharedStrings.xml'))
    return { close: async () => {}, get: async (_: number) => '' };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'masterino-office-'));
  const data = await open(path.join(dir, 'strings'), 'w+');
  const index = await open(path.join(dir, 'index'), 'w+');
  const source = zip.records('xl/sharedStrings.xml', 'si');
  let offset = 0,
    count = 0;
  const close = async () => {
    try {
      await source.return(undefined);
    } finally {
      await data.close();
      await index.close();
      await rm(dir, { recursive: true, force: true });
    }
  };
  return {
    close,
    get: async (id: number) => {
      if (!Number.isSafeInteger(id) || id < 0) throw new Error('Invalid shared string reference');
      while (count <= id) {
        const next = await source.next();
        if (next.done) throw new Error('Invalid shared string reference');
        const bytes = Buffer.from(textNodes(next.value));
        const record = Buffer.alloc(16);
        record.writeDoubleLE(offset);
        record.writeDoubleLE(bytes.length, 8);
        await data.write(bytes);
        await index.write(record);
        offset += bytes.length;
        count++;
      }
      const record = Buffer.alloc(16);
      await index.read(record, 0, 16, id * 16);
      const bytes = Buffer.alloc(record.readDoubleLE(8));
      await data.read(bytes, 0, bytes.length, record.readDoubleLE());
      return bytes.toString('utf8');
    },
  };
}

async function readOfficeDocumentUncached(params: OfficeReadParams) {
  const start = integer(params.start, 1, Number.MAX_SAFE_INTEGER);
  const limit = integer(params.limit, 100, 500);
  const maxChars = integer(params.maxChars, 24_000, 64_000);
  const version = await versionOf(params.path);
  if (params.version && params.version !== version)
    throw new Error('OFFICE_VERSION_CHANGED: inspect the current document again');
  const format = path.extname(params.path).slice(1).toLowerCase();
  if (!['xlsx', 'docx', 'pptx'].includes(format))
    throw new Error('Supported Office formats: xlsx, docx, pptx');
  if (params.aggregateColumn && !/^[A-Z]{1,3}$/.test(params.aggregateColumn))
    throw new Error('Use a column letter for aggregation');
  if (
    params.groupByColumn &&
    (!params.aggregateColumn || !/^[A-Z]{1,3}$/.test(params.groupByColumn))
  )
    throw new Error('groupByColumn requires aggregateColumn and a column letter');
  const groups = new Map<string, { count: number; sum: number; min: number; max: number }>();
  const aggregate = { count: 0, sum: 0, min: Infinity, max: -Infinity };
  const zip = await openOfficeZip(params.path);
  const records: OfficeRecord[] = [];
  let chars = 0,
    hasMore = false,
    total: number | 'unknown' = 'unknown',
    sheet: string | undefined;
  const accept = (record: OfficeRecord) => {
    if (record.index < start) return true;
    if (params.aggregateColumn && record.cells) {
      const cell = record.cells.find(
        (c) => c.address.replaceAll(/\d+/g, '') === params.aggregateColumn,
      );
      if (cell && cell.value.trim() !== '' && Number.isFinite(Number(cell.value))) {
        const value = Number(cell.value);
        if (params.groupByColumn) {
          const key =
            record.cells.find((c) => c.address.replaceAll(/\d+/g, '') === params.groupByColumn)
              ?.value ?? '';
          if (key.length > 1000 || (!groups.has(key) && groups.size >= 500))
            throw new Error(
              'Grouping exceeds 500 groups or 1000 characters per key; use same-environment code for this dataset',
            );
          const group = groups.get(key) ?? { count: 0, sum: 0, min: Infinity, max: -Infinity };
          group.count++;
          group.sum += value;
          group.min = Math.min(group.min, value);
          group.max = Math.max(group.max, value);
          groups.set(key, group);
        }
        aggregate.count++;
        aggregate.sum += value;
        aggregate.min = Math.min(aggregate.min, value);
        aggregate.max = Math.max(aggregate.max, value);
      }
      return true;
    }
    const size = JSON.stringify(record).length;
    if (records.length >= limit || chars + size > maxChars) {
      if (!records.length && size > maxChars)
        throw new Error(
          'Office record exceeds output budget; increase maxChars or use local aggregation',
        );
      hasMore = true;
      return false;
    }
    records.push(record);
    chars += size;
    return true;
  };
  try {
    if (format === 'xlsx') {
      const sheets = await sheetParts(zip);
      const selected = params.sheet ? sheets.find((s) => s.name === params.sheet) : sheets[0];
      if (!selected) throw new Error('Worksheet not found');
      sheet = selected.name;
      const strings = await sharedStrings(zip);
      try {
        let lastRow = 0;
        for await (const xml of zip.records(selected.part, 'row')) {
          const row = Number(attr(xml, 'r')) || lastRow + 1;
          lastRow = row;
          if (row < start) continue;
          // Establish pagination without resolving strings from the first excluded row.
          if (!params.aggregateColumn && records.length >= limit) {
            hasMore = true;
            break;
          }
          const cells: NonNullable<OfficeRecord['cells']> = [];
          for (const [cell] of xml.matchAll(/<c\s[^>]*>[\s\S]*?<\/c>/g)) {
            const raw = unescapeXml(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? '');
            const type = attr(cell, 't');
            const formula = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(cell)?.[1];
            cells.push({
              address: attr(cell, 'r'),
              value:
                type === 's'
                  ? await strings.get(Number(raw))
                  : type === 'inlineStr'
                    ? textNodes(cell)
                    : raw,
              ...(formula !== undefined && { formula: unescapeXml(formula) }),
            });
          }
          if (!accept({ index: row, cells })) break;
        }
        if (!hasMore) total = lastRow;
      } finally {
        await strings.close();
      }
    } else if (format === 'docx') {
      let index = 0;
      for await (const xml of zip.records('word/document.xml', 'w:p')) {
        index++;
        const style = /<w:pStyle\s[^>]*w:val=["']([^"']*)/.exec(xml)?.[1];
        if (
          !accept({
            index,
            text: textNodes(xml, 'w:'),
            ...(style && /^heading/i.test(style) && { heading: style }),
          })
        )
          break;
      }
      if (!hasMore) total = index;
    } else {
      const presentation = await zip.text('ppt/presentation.xml');
      const rels = [
        ...(await zip.text('ppt/_rels/presentation.xml.rels')).matchAll(/<Relationship\s[^>]*>/g),
      ];
      const slides = [...presentation.matchAll(/<p:sldId\s[^>]*>/g)];
      total = slides.length;
      for (let i = start - 1; i < slides.length; i++) {
        const id = attr(slides[i]![0], 'r:id');
        const rel = rels.find(([r]) => attr(r, 'Id') === id)?.[0] ?? '';
        const target = attr(rel, 'Target');
        const part = target.startsWith('/')
          ? target.slice(1)
          : path.posix.normalize(`ppt/${target}`);
        const xml = await zip.text(part, 2 * 1024 * 1024);
        if (!accept({ index: i + 1, text: textNodes(xml, 'a:') })) break;
      }
    }
    if ((await versionOf(params.path)) !== version)
      throw new Error('OFFICE_VERSION_CHANGED during read');
    if (JSON.stringify([...groups]).length > maxChars)
      throw new Error('Grouping result exceeds output budget; narrow the dataset or use code');
    return {
      ...(params.groupByColumn && {
        groups: [...groups].map(([key, value]) => ({ key, ...value })),
      }),
      ...(params.aggregateColumn && {
        aggregate: {
          ...aggregate,
          min: aggregate.count ? aggregate.min : null,
          max: aggregate.count ? aggregate.max : null,
        },
      }),
      format,
      version,
      sheet,
      records,
      total,
      hasMore,
      actualRange: records.length ? [records[0]!.index, records.at(-1)!.index] : [],
      ...(hasMore ? { next: { ...params, sheet, start: records.at(-1)!.index + 1, version } } : {}),
    };
  } finally {
    zip.close();
  }
}
const resultCache = new Map<string, Awaited<ReturnType<typeof readOfficeDocumentUncached>>>();
export async function readOfficeDocument(params: OfficeReadParams) {
  const currentVersion = await versionOf(params.path);
  if (params.version && params.version !== currentVersion)
    throw new Error('OFFICE_VERSION_CHANGED');
  const key = JSON.stringify({ ...params, version: currentVersion });
  const cached = resultCache.get(key);
  if (cached) return structuredClone(cached);
  const result = await readOfficeDocumentUncached({ ...params, version: currentVersion });
  // At most sixteen bounded results; version changes cannot hit stale entries.
  if (resultCache.size >= 16) resultCache.delete(resultCache.keys().next().value!);
  resultCache.set(key, structuredClone(result));
  return result;
}
export async function inspectOfficeDocument(params: OfficeReadParams) {
  const result = await readOfficeDocument({ ...params, limit: params.limit ?? 5 });
  if (result.format !== 'xlsx') return result;
  const zip = await openOfficeZip(params.path);
  try {
    const sheets = await sheetParts(zip);
    if ((await versionOf(params.path)) !== result.version)
      throw new Error('OFFICE_VERSION_CHANGED');
    return {
      ...result,
      sheets: sheets.slice(0, 100).map((s) => s.name),
      sheetTotal: sheets.length,
      sheetsHasMore: sheets.length > 100,
    };
  } finally {
    zip.close();
  }
}

export * from './modify';
export * from './write';
