import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { readOfficeDocument } from '../../packages/file-loaders/src/office';
import { executeDocumentOperation } from '../../packages/file-loaders/src/documents';
if (process.env.APP_URL !== 'https://mlai-test.bielcrystal.com') throw Error('TEST only');
const root = await mkdtemp(path.join(os.tmpdir(), 'masterino-document-benchmark-'));
const python = process.env.MASTERINO_DOCUMENT_TEST_PYTHON!;
execFileSync(python, ['-I', '-B', 'e2e/documents/fixtures.py', root]);
const file = path.join(root, 'million.xlsx');
const options = {
  cacheRoot: root,
  python,
  scriptPath: path.resolve('apps/desktop/python/documents.py'),
};
const measure = async (name: string, run: () => Promise<any>) => {
  const start = performance.now();
  const result = await run();
  const entry = {
    name,
    elapsedMs: Math.round(performance.now() - start),
    resultBytes: Buffer.byteLength(JSON.stringify(result)),
    rowsScanned: result.rowsScanned,
    peakRssBytes: result.peakRssBytes,
  };
  console.log(JSON.stringify(entry));
  return { result, entry };
};
try {
  const previous = await measure('existing grouped aggregate', () =>
    readOfficeDocument({ path: file, start: 2, aggregateColumn: 'B', groupByColumn: 'C' }),
  );
  const dataset = await measure('new cold dataset + metric analysis', () =>
    executeDocumentOperation(
      'analyzeSpreadsheet',
      {
        path: file,
        start: 2,
        columns: ['A', 'B', 'C'],
        metrics: [{ column: 'B', name: 'B', lower: 9, upper: 11 }],
      },
      options,
    ),
  );
  const reused = await measure('new grouped query + exact distinct', () =>
    executeDocumentOperation(
      'querySpreadsheet',
      {
        datasetPath: dataset.result.datasetPath,
        groupBy: ['C'],
        distinct: ['A'],
        metrics: [{ column: 'B' }],
        sampleLimit: 3,
      },
      options,
    ),
  );
  await writeFile(
    'e2e/documents/.artifacts/benchmark.json',
    JSON.stringify(
      { rows: 1000000, previous: previous.entry, cold: dataset.entry, reused: reused.entry },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
