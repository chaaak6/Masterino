// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { inspectOfficeDocument, readOfficeDocument } from './index';
const dirs: string[] = [];
const fixture = async (name: string) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-test-'));
  dirs.push(dir);
  return path.join(dir, name);
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function zipFile(file: string, parts: Record<string, string>) {
  const zip = XLSX.CFB.utils.cfb_new();
  for (const [name, xml] of Object.entries(parts))
    XLSX.CFB.utils.cfb_add(zip, name, Buffer.from(xml));
  await writeFile(file, XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }));
}
it('reads XLSX shared strings, pagination, formula cache and aggregate', async () => {
  const file = await fixture('data.xlsx');
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['name', 'amount'],
    ...Array.from({ length: 1000 }, (_, i) => [`row ${i}`, i + 1]),
  ]);
  sheet.B2 = { t: 'n', v: 1, f: '1+0' };
  XLSX.utils.book_append_sheet(book, sheet, 'Sales');
  await writeFile(
    file,
    XLSX.write(book, { type: 'buffer', bookType: 'xlsx', bookSST: true, compression: true }),
  );
  const first = await inspectOfficeDocument({ path: file, limit: 2 });
  expect(first.records[1]?.cells?.[0]?.value).toBe('row 0');
  expect(first.records[1]?.cells?.[1]?.formula).toBe('1+0');
  expect(first.hasMore).toBe(true);
  expect((await readOfficeDocument(first.next!)).actualRange[0]).toBe(3);
  const sum = await readOfficeDocument({ path: file, aggregateColumn: 'B' });
  expect(sum.aggregate?.sum).toBe(500500);
  expect(sum.records).toEqual([]);
  await expect(readOfficeDocument({ path: file, version: 'stale' })).rejects.toThrow(
    'VERSION_CHANGED',
  );
});
it('uses presentation relationship order', async () => {
  const file = await fixture('slides.pptx');
  await zipFile(file, {
    'ppt/presentation.xml':
      '<p:presentation><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels':
      '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': '<a:t>One</a:t>',
    'ppt/slides/slide2.xml': '<a:t>Two</a:t>',
  });
  expect((await readOfficeDocument({ path: file })).records.map((r) => r.text)).toEqual([
    'Two',
    'One',
  ]);
});
it('extracts Word headings and bounded paragraphs', async () => {
  const file = await fixture('doc.docx');
  await zipFile(file, {
    'word/document.xml':
      '<w:document><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p><w:p><w:r><w:t>Body &amp; text</w:t></w:r></w:p></w:document>',
  });
  const result = await readOfficeDocument({ path: file, limit: 1 });
  expect(result.records[0]?.heading).toBe('Heading1');
  expect(result.hasMore).toBe(true);
  expect((await readOfficeDocument(result.next!)).records[0]?.text).toBe('Body & text');
});

it('creates a real offline xlsx and preserves an existing destination', async () => {
  const { createOfficeDocument } = await import('./write');
  const file = await fixture('created.xlsx');
  const params = {
    path: file,
    sheets: [
      {
        name: 'Data',
        rows: [
          ['name', 'amount'],
          ['Alice', 42],
        ],
      },
    ],
  };
  const created = await createOfficeDocument(params);
  expect(created.cells).toBe(4);
  const parsed = await readOfficeDocument({ path: file });
  expect(parsed.records[1]?.cells?.[1]?.value).toBe('42');
  await expect(
    createOfficeDocument({ ...params, sheets: [{ name: 'Bad', rows: [[99]] }] }),
  ).rejects.toThrow();
  expect((await readOfficeDocument({ path: file })).version).toBe(parsed.version);
});

it('groups numeric values and edits/templates into new validated workbooks', async () => {
  const { createOfficeDocument, batchOfficeDocument, mergeOfficeTemplate, validateOfficeDocument } =
    await import('./index');
  const file = await fixture('input.xlsx');
  await createOfficeDocument({
    path: file,
    sheets: [
      {
        name: 'Data',
        rows: [
          ['group', 'value'],
          ['A', 10],
          ['B', 20],
          ['A', 5],
          ['{{name}}', 0],
        ],
      },
    ],
  });
  const grouped = await readOfficeDocument({
    path: file,
    start: 2,
    aggregateColumn: 'B',
    groupByColumn: 'A',
  });
  expect(grouped.groups?.find((g) => g.key === 'A')?.sum).toBe(15);
  const outputPath = path.join(path.dirname(file), 'edited.xlsx');
  await batchOfficeDocument({
    path: file,
    outputPath,
    operations: [{ sheet: 'Data', cell: 'B2', value: 99 }],
  });
  expect((await readOfficeDocument({ path: outputPath })).records[1]?.cells?.[1]?.value).toBe('99');
  expect((await readOfficeDocument({ path: file })).records[1]?.cells?.[1]?.value).toBe('10');
  const merged = path.join(path.dirname(file), 'merged.xlsx');
  await mergeOfficeTemplate({ path: file, outputPath: merged, values: { name: 'Alice' } });
  expect((await readOfficeDocument({ path: merged })).records[4]?.cells?.[0]?.value).toBe('Alice');
  expect((await validateOfficeDocument({ path: merged })).valid).toBe(true);
  await expect(
    batchOfficeDocument({
      path: file,
      outputPath: file,
      operations: [{ sheet: 'Data', cell: 'B2', value: 123 }],
    }),
  ).rejects.toThrow();
  expect((await readOfficeDocument({ path: file })).version).toBe(grouped.version);
});

it('creates Word and PowerPoint with pinned engines and independent ordered text readback', async () => {
  const { createOfficeDocument } = await import('./index');
  const word = await fixture('created.docx');
  await createOfficeDocument({
    path: word,
    paragraphs: [{ text: 'Quarterly report', heading: true }, { text: 'Revenue grew by 20%.' }],
  });
  expect((await readOfficeDocument({ path: word })).records.map((r) => r.text)).toEqual([
    'Quarterly report',
    'Revenue grew by 20%.',
  ]);
  const slides = await fixture('created.pptx');
  await createOfficeDocument({
    path: slides,
    slides: [
      { title: 'First', body: 'Revenue' },
      { title: 'Second', body: 'Costs' },
    ],
  });
  expect((await readOfficeDocument({ path: slides })).records.map((r) => r.text)).toEqual([
    'FirstRevenue',
    'SecondCosts',
  ]);
});

it('preserves untouched formulas and clears cells during batch editing', async () => {
  const { batchOfficeDocument } = await import('./index');
  const file = await fixture('formulas.xlsx');
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[1, 2, 3]]);
  sheet.C1 = { t: 'n', f: 'A1+B1', v: 3 };
  XLSX.utils.book_append_sheet(book, sheet, 'Data');
  await writeFile(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  const outputPath = path.join(path.dirname(file), 'changed.xlsx');
  await batchOfficeDocument({
    path: file,
    outputPath,
    operations: [
      { sheet: 'Data', cell: 'A1', value: 10 },
      { sheet: 'Data', cell: 'B1', value: null },
    ],
  });
  const result = await readOfficeDocument({ path: outputPath });
  expect(result.records[0]?.cells?.find((c) => c.address === 'C1')?.formula).toBe('A1+B1');
  expect(result.records[0]?.cells?.find((c) => c.address === 'B1')).toBeUndefined();
});
