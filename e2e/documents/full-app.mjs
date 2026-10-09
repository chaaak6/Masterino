import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
assert.equal(process.env.APP_URL, 'https://mlai-test.bielcrystal.com');
const python = process.env.MASTERINO_DOCUMENT_TEST_PYTHON;
assert.ok(python);
const expectedProfile =
  process.env.MASTERINO_DOCUMENT_TEST_PROFILE ?? 'masterino-desktop-test-server';
assert.match(expectedProfile, /^masterino-desktop-(?:test-server|local-[a-f0-9]{12})$/);
const root = process.cwd();
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().startsWith('app://renderer/'));
assert.ok(page, 'Isolated test app page is required');
await page.waitForFunction(() => window.electronAPI?.invoke);
const appState = await page.evaluate(() => window.electronAPI.invoke('system.getAppState'));
assert.equal(
  path.basename(appState.userPath.userData),
  expectedProfile,
  'Connect only to the isolated test profile',
);
const device = await page.evaluate(() =>
  window.electronAPI.invoke('gatewayConnection.getDeviceInfo'),
);
assert.ok(device.deviceId);
const directory = await mkdtemp(path.join(os.tmpdir(), 'masterino-full-app-docs-'));
execFileSync(python, ['-I', '-B', 'e2e/documents/fixtures.py', directory]);
const invoke = async (apiName, args, topicId = 'bdd-full-app-documents') => {
  const result = await page.evaluate(
    ({ apiName, args, directory, deviceId, topicId, toolCallId }) =>
      window.electronAPI.invoke('gatewayConnection.executeLocalToolCall', {
        apiName,
        args,
        trace: { deviceId, topicId, operationId: 'bdd-full-app-operation', toolCallId },
        executionContext: {
          cwd: directory,
          workspaceRootPath: directory,
          accessRoots: [
            {
              rootPath: directory,
              scope: 'primary',
              source: 'workspace',
              modes: ['read', 'write', 'exec'],
            },
          ],
        },
      }),
    { apiName, args, directory, deviceId: device.deviceId, topicId, toolCallId: randomUUID() },
  );
  assert.equal(result.success, true, JSON.stringify(result));
  return result.state;
};
const done = async (job) => {
  for (let i = 0; i < 600; i++) {
    const state = await invoke('getDocumentJob', { jobId: job.jobId });
    if (state.status === 'completed') return state.result;
    if (state.status === 'failed' || state.status === 'cancelled')
      throw Error(state.error ?? state.status);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Timed out');
};
try {
  const known = path.join(directory, 'known.xlsx');
  assert.equal((await invoke('inspectFile', { path: known })).sheets[0].name, 'Data');
  const old = await invoke('readOfficeDocument', { path: known, start: 2, limit: 2 });
  assert.equal(old.records[0].cells[1].value, '8');
  const bytes = await readFile(known);
  const transfer = await page.evaluate(
    (size) =>
      window.electronAPI.invoke('localSystem.beginAttachmentTransfer', {
        draftId: 'bdd-full-app',
        name: 'selected.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size,
      }),
    bytes.length,
  );
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    await page.evaluate(
      (input) =>
        window.electronAPI.invoke('localSystem.appendAttachmentTransfer', {
          ...input,
          data: new Uint8Array(input.data),
        }),
      {
        transferId: transfer.transferId,
        offset,
        data: Array.from(bytes.subarray(offset, offset + 1024)),
      },
    );
  }
  const attachment = await page.evaluate(
    (transferId) =>
      window.electronAPI.invoke('localSystem.finishAttachmentTransfer', { transferId }),
    transfer.transferId,
  );
  await page.evaluate(
    (ref) =>
      window.electronAPI.invoke('localSystem.bindAttachment', {
        ref,
        topicId: 'bdd-full-app-documents',
      }),
    attachment,
  );
  assert.equal(
    (await invoke('inspectFile', { attachmentId: attachment.attachmentId })).sheets[0].name,
    'Data',
  );
  await page.evaluate(
    (ref) =>
      window.electronAPI.invoke('localSystem.manageAttachment', {
        action: 'releaseDraft',
        draftId: 'bdd-full-app',
        ref,
      }),
    attachment,
  );
  const result = await done(
    await invoke('analyzeSpreadsheet', {
      path: known,
      columns: ['A', 'B', 'C'],
      start: 2,
      metrics: [{ column: 'B', name: '直径', lower: 9, upper: 11 }],
    }),
  );
  assert.deepEqual(result.classification, { pass: 1, fail: 2, incomplete: 2 });
  const query = await done(
    await invoke('querySpreadsheet', {
      datasetId: result.datasetId,
      groupBy: ['C'],
      distinct: ['A'],
      filters: [{ column: 'B', op: 'gte', value: 9 }],
      sampleLimit: 2,
    }),
  );
  assert.equal(query.matchedRows, 2);
  assert.equal(query.sourceScans, 0);
  const xlsx = path.join(directory, 'verified.xlsx'),
    pdf = path.join(directory, 'verified.pdf');
  await done(
    await invoke('exportDocumentReport', {
      datasetId: result.datasetId,
      outputPath: xlsx,
      pdfPath: pdf,
      metrics: [{ column: 'B', name: '直径', lower: 9, upper: 11 }],
    }),
  );
  assert.ok(
    (await invoke('readPdfPages', { path: pdf, pages: [1] })).pages[0].text.includes('直径'),
  );
  const rendered = await done(await invoke('renderPdfPages', { path: pdf, pages: [1] }));
  assert.ok(rendered.pages[0].previewUrl);
  assert.equal(
    await page.evaluate(
      (url) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image.naturalWidth > 0);
          image.onerror = () => resolve(false);
          image.src = url;
        }),
      rendered.pages[0].previewUrl,
    ),
    true,
    'Generated page must load through an exact-file preview token',
  );
  const report = {
    environment: 'test app against https://mlai-test.bielcrystal.com',
    cases: [
      'actual renderer preload IPC',
      'chunked attachment IPC + attachmentId tools',
      'metadata inspection',
      'existing Office bounded read',
      'document worker + Python dataset',
      'structured filters and samples',
      'Chinese XLSX/PDF export and readback',
      'PDF rendering and exact-file preview token',
    ],
    passed: true,
  };
  await writeFile(
    'e2e/documents/.artifacts/full-app-acceptance.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await rm(directory, { recursive: true, force: true });
  await browser.close();
}
