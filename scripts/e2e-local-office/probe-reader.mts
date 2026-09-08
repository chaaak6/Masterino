/** Supplemental parser measurements. Real Electron/model acceptance is recorded separately. */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  inspectOfficeDocument,
  readOfficeDocument,
} from '../../packages/file-loaders/src/office/index';

const require = createRequire(new URL('../../packages/file-loaders/package.json', import.meta.url));
const yauzl = require('yauzl');

const originalOpen = yauzl.ZipFile.prototype.openReadStream;
let parts: { name: string; expandedBytes: number; consumedBytes: number }[] = [];
yauzl.ZipFile.prototype.openReadStream = function (entry: any, callback: any) {
  const measured = {
    name: entry.fileName,
    expandedBytes: entry.uncompressedSize,
    consumedBytes: 0,
  };
  parts.push(measured);
  return originalOpen.call(this, entry, (error: Error | null, stream: any) => {
    if (stream)
      stream.on('data', (chunk: Buffer) => {
        measured.consumedBytes += chunk.length;
      });
    callback(error, stream);
  });
};

const root = process.argv[2] ?? '/tmp/masterino-office-qa';
const name = process.argv[3] ?? 'sales-100000.xlsx';
const file = path.join(root, name);
const oracle = JSON.parse(await readFile(path.join(root, 'oracle.json'), 'utf8')).workbooks[name];
assert.ok(oracle);
const measurements = [];
async function measure(label: string, run: () => Promise<any>) {
  parts = [];
  const started = performance.now();
  const result = await run();
  measurements.push({
    label,
    milliseconds: +(performance.now() - started).toFixed(3),
    outputBytes: Buffer.byteLength(JSON.stringify(result)),
    records: result.records.length,
    actualRange: result.actualRange,
    hasMore: result.hasMore,
    aggregate: result.aggregate,
    parts,
    rssBytes: process.memoryUsage().rss,
    processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
  });
  return result;
}
try {
  const first = await measure('cold-inspect', () => inspectOfficeDocument({ path: file }));
  assert.equal(first.records.length, 5);
  assert.equal(first.hasMore, true);
  const sheetScan = measurements[0].parts.find((p) => p.name === 'xl/worksheets/sheet1.xml');
  assert.ok(sheetScan && sheetScan.consumedBytes < sheetScan.expandedBytes / 10);
  await measure('repeat-inspect', () => inspectOfficeDocument({ path: file }));
  const tail = await measure('last-three-rows', () =>
    readOfficeDocument({ path: file, start: oracle.rows - 1, limit: 3 }),
  );
  assert.deepEqual(tail.actualRange, [oracle.rows - 1, oracle.rows + 1]);
  assert.equal(tail.hasMore, false);
  const grouped = await measure('grouped-aggregate', () =>
    readOfficeDocument({ path: file, start: 2, aggregateColumn: 'G', groupByColumn: 'C' }),
  );
  assert.equal(grouped.aggregate?.sum, oracle.revenue);
  assert.equal(grouped.aggregate?.count, oracle.rows);
  assert.deepEqual(Object.fromEntries(grouped.groups!.map((g) => [g.key, g.sum])), oracle.byRegion);
  // A different query avoids the completed aggregate's result-cache entry.
  parts = [];
  const abortController = new AbortController();
  const cancelledReason = new Error('probe cancellation');
  let cancelAt = 0;
  const cancelTimer = setTimeout(() => {
    cancelAt = performance.now();
    abortController.abort(cancelledReason);
  }, 10);
  try {
    await assert.rejects(
      readOfficeDocument(
        { path: file, start: 2, aggregateColumn: 'G' },
        { signal: abortController.signal },
      ),
      (error) => error === cancelledReason,
    );
  } finally {
    clearTimeout(cancelTimer);
  }
  const cancellation = { latencyMs: +(performance.now() - cancelAt).toFixed(3), parts };
  console.log(
    JSON.stringify(
      {
        kind: 'supplemental-parser-probe',
        file: name,
        inputBytes: (await stat(file)).size,
        node: process.version,
        measurements,
        cancellation,
      },
      null,
      2,
    ),
  );
} finally {
  yauzl.ZipFile.prototype.openReadStream = originalOpen;
}
