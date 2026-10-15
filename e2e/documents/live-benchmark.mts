import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { executeDocumentOperation } from '../../packages/file-loaders/src/documents';
import { readOfficeDocument } from '../../packages/file-loaders/src/office';

assert.equal(process.env.APP_URL, 'https://mlai-test.bielcrystal.com');
const directory = path.resolve(process.argv[2]);
const golden = JSON.parse(await readFile(path.join(directory, 'golden.json'), 'utf8'));
const file = path.join(directory, golden.file);
assert.match(golden.file, /^synthetic-\d+-rows\.xlsx$/);
const cacheRoot = await mkdtemp(path.join(os.tmpdir(), 'pr138-live-benchmark-'));
const options = {
  cacheRoot,
  python: process.env.MASTERINO_DOCUMENT_TEST_PYTHON!,
  scriptPath: path.resolve('apps/desktop/python/documents.py'),
};
assert.ok(options.python);
const entries: any[] = [];
const measure = async (name: string, action: () => Promise<any>) => {
  const start = performance.now();
  const result = await action();
  const entry = {
    name,
    elapsedMs: Math.round(performance.now() - start),
    resultBytes: Buffer.byteLength(JSON.stringify(result)),
    pythonPeakRssBytes: result.peakRssBytes,
    hostProcessMaxRssKiB: process.resourceUsage().maxRSS,
    sourceScans: result.sourceScans,
  };
  entries.push(entry);
  console.log(JSON.stringify(entry));
  return result;
};
const previous = await measure('existing grouped aggregate', () =>
  readOfficeDocument({
    path: file,
    sheet: 'Measurements',
    start: 2,
    aggregateColumn: 'B',
    groupByColumn: 'C',
  }),
);
assert.equal(previous.aggregate.count, golden.validCount);
assert.ok(Math.abs(previous.aggregate.sum / previous.aggregate.count - golden.mean) < 1e-10);
const analysis = await measure('cold dataset and full quality analysis', () =>
  executeDocumentOperation(
    'analyzeSpreadsheet',
    {
      path: file,
      sheet: 'Measurements',
      start: 2,
      columns: ['A', 'B', 'C'],
      metrics: [{ column: 'B', name: 'measurement', ...golden.bounds }],
    },
    options,
  ),
);
assert.deepEqual(analysis.classification, golden.classification);
const metric = analysis.metrics.measurement;
assert.equal(metric.validCount, golden.validCount);
assert.equal(metric.errorCount, golden.errorCount);
assert.equal(metric.missingCount, golden.missingCount);
assert.ok(Math.abs(metric.mean - golden.mean) < 1e-10);
assert.ok(Math.abs(metric.stddev - golden.sampleStddev) < 1e-10);
const query = await measure('reused grouping plus exact distinct and samples', () =>
  executeDocumentOperation(
    'querySpreadsheet',
    {
      datasetPath: analysis.datasetPath,
      groupBy: ['C'],
      distinct: ['A'],
      metrics: [{ column: 'B', name: 'measurement' }],
      sampleLimit: 3,
    },
    options,
  ),
);
assert.equal(query.sourceScans, 0);
assert.equal(query.distinctCount, golden.distinctRecordIds);
assert.equal(query.groups.length, 12);
for (const group of query.groups) {
  const old = previous.groups.find((item: any) => item.key === group.key[0]);
  assert.equal(group.rows, golden.groups[group.key[0]]);
  assert.equal(group.validCounts.measurement, old.count);
  assert.ok(Math.abs(group.means.measurement - old.sum / old.count) < 1e-10);
}
await writeFile(
  path.join(directory, '../logs/live-benchmark.json'),
  JSON.stringify(
    {
      rows: golden.rows,
      inputBytes: golden.bytes,
      expandedBytes: golden.expandedBytes,
      numericalChecksPassed: true,
      entries,
      note: 'Cold operations compute different statistics. Grouped means/valid counts agree. Host max RSS is cumulative; Python peak is a separate process, not total App memory.',
    },
    null,
    2,
  ),
);
