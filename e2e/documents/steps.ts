import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AfterAll, BeforeAll, Given, Then, When, setDefaultTimeout } from '@cucumber/cucumber';
import { executeDocumentOperation } from '../../packages/file-loaders/src/documents';
import { readOfficeDocument } from '../../packages/file-loaders/src/office';
setDefaultTimeout(300_000);
let root: string, file: string, result: any, query: any;
const python = process.env.MASTERINO_DOCUMENT_TEST_PYTHON!;
const analysis = {
  columns: ['A', 'B', 'C'],
  metrics: [{ column: 'B', name: 'measurement', lower: 9, upper: 11 }],
  start: 2,
};
BeforeAll(async () => {
  assert.equal(process.env.APP_URL, 'https://mlai-test.bielcrystal.com');
  assert.ok(python, 'Set the isolated test Python path');
  root = await mkdtemp(path.join(os.tmpdir(), 'masterino-doc-bdd-'));
  execFileSync(python, ['-I', '-B', 'e2e/documents/fixtures.py', root]);
  execFileSync(process.execPath, ['e2e/documents/build.mjs']);
});
AfterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
const run = (operation: string, args: any) =>
  executeDocumentOperation(operation, args, {
    cacheRoot: root,
    python,
    scriptPath: path.resolve('apps/desktop/python/documents.py'),
  });
Given('a workbook whose worksheet expands beyond one GiB', () => {
  file = path.join(root, 'expanded.xlsx');
});
Given('a workbook with known measurements, missing values and cached formulas', () => {
  file = path.join(root, 'known.xlsx');
});
Given('a million row workbook', () => {
  file = path.join(root, 'million.xlsx');
});
When('the agent inspects the file', async () => {
  result = await run('inspectFile', { path: file });
});
Then('inspection lists its sheet and recommends dataset analysis without reading its rows', () => {
  assert.equal(result.sheets[0].name, 'Data');
  assert.ok(result.expandedBytes > 1024 ** 3);
  assert.equal(result.recommendedStrategy, 'dataset');
  assert.equal(result.records, undefined);
});
When('the agent analyzes the measurement columns together', async () => {
  result = await run('analyzeSpreadsheet', { path: file, ...analysis });
});
Then('the full scan reports exact pass fail and incomplete counts', () => {
  assert.equal(result.rowsScanned, 5);
  assert.deepEqual(result.classification, { pass: 1, fail: 2, incomplete: 2 });
  assert.equal(result.metrics.measurement.mean, 10);
  assert.equal(result.metrics.measurement.validCount, 3);
  assert.equal(result.metrics.measurement.cacheMissingCount, 1);
  assert.equal(result.metrics.measurement.errorCount, 1);
});
When('the agent queries the existing dataset by category', async () => {
  query = await run('querySpreadsheet', {
    datasetPath: result.datasetPath,
    groupBy: ['C'],
    metrics: [{ column: 'B', name: 'measurement' }],
    distinct: ['A'],
  });
});
Then('the query returns the known groups without parsing the workbook again', () => {
  assert.equal(query.sourceScans, 0);
  assert.equal(query.distinctCount, 3);
  assert.equal(query.groups.length, 2);
  assert.equal(query.groups.find((g: any) => g.key[0] === 'alpha').rows, 3);
});
Then('it reports one million scanned rows and a bounded result', () => {
  assert.equal(result.rowsScanned, 1000000);
  assert.deepEqual(result.classification, { pass: 200000, fail: 400000, incomplete: 400000 });
  assert.ok(JSON.stringify(result).length < 24000);
  assert.ok(result.peakRssBytes < 1024 ** 3);
});
When('the agent reads a selected Office range', async () => {
  result = await readOfficeDocument({ path: file, start: 2, limit: 2 });
});
Then('the known cells and formulas remain readable', () => {
  assert.equal(result.records[0].cells[1].value, '8');
  assert.equal(result.records[1].cells[1].formula, '5+5');
});
Given('a three page PDF', () => {
  file = path.resolve('packages/file-loaders/src/loaders/pdf/fixtures/test.pdf');
});
When('the agent reads page two and searches the PDF', async () => {
  result = await run('readPdfPages', { path: file, pages: [2], maxChars: 1000 });
  query = await run('searchPdf', { path: file, query: 'the', topK: 2 });
});
Then('results contain page two evidence and bounded search matches', () => {
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].pageNumber, 2);
  assert.ok(result.pages[0].text.length > 0);
  assert.ok(query.matches.length <= 2);
  assert.equal(query.complete, true);
});

let transfer: any, transfers: any, attachment: any;
Given('a fresh attachment transfer', async () => {
  const { LocalAttachmentTransfers } = await import('./.artifacts/device-attachments.js');
  transfers = new LocalAttachmentTransfers(path.join(root, 'attachments'), 'test-device');
  transfer = await transfers.begin({
    draftId: 'bdd-draft',
    name: 'large.csv',
    mime: 'text/csv',
    size: 101 * 1024 ** 2,
  });
});
When('the selected file is transferred in bounded chunks', async () => {
  const data = new Uint8Array(1024 ** 2);
  data.fill(65);
  for (let offset = 0; offset < 101 * 1024 ** 2; offset += data.length)
    await transfers.append(transfer.transferId, offset, data);
  attachment = await transfers.finish(transfer.transferId);
});
Then('its content is available only to the bound conversation', async () => {
  const { bindLocalAttachment, prepareLocalAttachmentById } =
    await import('./.artifacts/device-attachments.js');
  const attachmentRoot = path.join(root, 'attachments');
  assert.equal(attachment.size, 101 * 1024 ** 2);
  assert.equal(JSON.stringify(attachment).includes(attachmentRoot), false);
  await bindLocalAttachment(attachmentRoot, 'test-device', attachment, 'bdd-topic');
  const prepared = await prepareLocalAttachmentById(
    attachmentRoot,
    'test-device',
    'bdd-topic',
    attachment.attachmentId,
  );
  assert.equal(
    (await (await import('node:fs/promises')).stat(prepared.path)).size,
    101 * 1024 ** 2,
  );
  await assert.rejects(
    prepareLocalAttachmentById(
      attachmentRoot,
      'test-device',
      'other-topic',
      attachment.attachmentId,
    ),
    /NOT_AVAILABLE/,
  );
});

Given('a CSV file with known measurements', () => {
  file = path.join(root, 'known.csv');
});
When('the agent requests filtered row evidence', async () => {
  query = await run('querySpreadsheet', {
    datasetPath: result.datasetPath,
    filters: [{ column: 'B', op: 'gte', value: 9 }],
    sampleLimit: 2,
  });
});
Then('the matching rows and numeric quality counts are exact', () => {
  assert.equal(result.metrics.measurement.validCount, 3);
  assert.deepEqual(result.classification, { pass: 1, fail: 2, incomplete: 2 });
  assert.equal(query.matchedRows, 2);
  assert.equal(query.sourceScans, 0);
  assert.deepEqual(
    query.samples.map((sample: any) => sample.row),
    [3, 4],
  );
});
When('the agent queries with a bounded group limit', async () => {
  query = await run('querySpreadsheet', {
    datasetPath: result.datasetPath,
    groupBy: ['C'],
    limit: 1,
  });
});
Then('omitted groups are marked explicitly and counts remain exact', () => {
  assert.equal(query.truncated, true);
  assert.equal(query.complete, true);
  assert.equal(query.groups.length, 1);
  assert.equal(query.matchedRows, 5);
});
