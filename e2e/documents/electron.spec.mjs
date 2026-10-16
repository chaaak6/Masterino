import { test, expect, _electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  copyFile,
  stat,
  writeFile,
  utimes,
  cp,
  rename,
  readdir,
  readFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = process.cwd();
const python = process.env.MASTERINO_DOCUMENT_TEST_PYTHON;
let app, temp;
let electronExecutable;
const run = (operation, args, owner = 'test-device:test-topic') =>
  app.evaluate((_, p) => globalThis.documents.execute(p.operation, p.args, p.owner), {
    operation,
    args,
    owner,
  });
const done = async (job) => {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const result = await run('getDocumentJob', { jobId: job.jobId });
    if (result.status === 'completed') return result.result;
    if (result.status === 'failed' || result.status === 'cancelled')
      throw new Error(result.error ?? result.status);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Document job acceptance timeout');
};
test.beforeAll(async () => {
  expect(process.env.APP_URL).toBe('https://mlai-test.bielcrystal.com');
  expect(python).toBeTruthy();
  temp = await mkdtemp(path.join(os.tmpdir(), 'masterino-document-electron-'));
  execFileSync(python, ['-I', '-B', 'e2e/documents/fixtures.py', temp]);
  execFileSync(process.execPath, ['e2e/documents/build.mjs'], { cwd: root, stdio: 'inherit' });
  const modules = path.join(root, 'e2e/documents/.artifacts/node_modules');
  await mkdir(modules, { recursive: true });
  const dependencies = createRequire(path.join(root, 'packages/file-loaders/package.json'));
  for (const name of ['pdfjs-dist', '@napi-rs/canvas']) {
    const link = path.join(modules, name);
    await mkdir(path.dirname(link), { recursive: true });
    await rm(link, { recursive: true, force: true });
    let resolved = dependencies.resolve(name);
    while (!resolved.endsWith(name)) {
      resolved = path.dirname(resolved);
      if (resolved === '/') throw new Error('Dependency root missing');
    }
    await symlink(resolved, link);
  }
  const resources = path.join(root, 'e2e/documents/.artifacts/resources');
  await mkdir(resources, { recursive: true });
  await rm(path.join(resources, 'python-runtime'), { force: true, recursive: true });
  await symlink(path.dirname(path.dirname(python)), path.join(resources, 'python-runtime'));
  await mkdir(path.join(path.dirname(path.dirname(python)), 'report-fonts'), { recursive: true });
  await copyFile(
    path.join(root, 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'),
    path.join(path.dirname(path.dirname(python)), 'report-fonts/LiberationSans-Regular.ttf'),
  );
  await copyFile(
    path.join(root, 'apps/desktop/python/documents.py'),
    path.join(path.dirname(path.dirname(python)), 'documents.py'),
  );
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  const primary = createRequire(path.join(path.dirname(common), 'apps/desktop/package.json'));
  electronExecutable = process.env.ELECTRON_EXECUTABLE_PATH ?? primary('electron');
  app = await _electron.launch({
    executablePath: electronExecutable,
    args: [path.join(root, 'e2e/documents/.artifacts/electron-main.js')],
    env: {
      ...process.env,
      APP_URL: 'https://mlai-test.bielcrystal.com',
      MASTERINO_DOCUMENT_PROFILE: path.join(temp, 'profile'),
      MASTERINO_DOCUMENT_CACHE: path.join(temp, 'cache'),
      MASTERINO_DOCUMENT_WORKER: path.join(root, 'e2e/documents/.artifacts/document-worker.js'),
    },
  });
  app.process().stderr.on('data', (data) => process.stderr.write(data));
  await expect.poll(() => app.evaluate(() => globalThis.documentsReady)).toBe(true);
});
test.afterAll(async () => {
  await app?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
});
test('real desktop worker, reusable dataset, XLSX/PDF export and ownership', async () => {
  const inactive = path.join(temp, 'cache', 'a'.repeat(64));
  await mkdir(inactive, { recursive: true });
  const stale = path.join(inactive, 'expired.duckdb');
  const fresh = path.join(inactive, 'recent.duckdb');
  await writeFile(stale, 'old dataset');
  await writeFile(fresh, 'recent dataset');
  const yesterday = new Date(Date.now() - 2 * 86400000);
  await utimes(stale, yesterday, yesterday);
  const analysis = {
    columns: ['A', 'B', 'C'],
    metrics: [{ column: 'B', name: 'measurement 直径', lower: 9, upper: 11 }],
    start: 2,
  };
  const result = await done(
    await run('analyzeSpreadsheet', { path: path.join(temp, 'known.xlsx'), ...analysis }),
  );
  await expect(stat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await stat(fresh)).size).toBeGreaterThan(0);
  expect(result.classification).toEqual({ pass: 1, fail: 2, incomplete: 2 });
  expect(result.datasetPath).toBeUndefined();
  expect(result.datasetId).toBeTruthy();
  await expect(
    run('querySpreadsheet', { datasetId: result.datasetId, groupBy: ['C'] }, 'other-topic'),
  ).rejects.toThrow(/unavailable/);
  const query = await done(
    await run('querySpreadsheet', { datasetId: result.datasetId, groupBy: ['C'], distinct: ['A'] }),
  );
  expect(query.distinctCount).toBe(3);
  expect(query.sourceScans).toBe(0);
  const xlsx = path.join(temp, 'report.xlsx'),
    pdf = path.join(temp, 'report.pdf');
  const exported = await done(
    await run('exportDocumentReport', {
      datasetId: result.datasetId,
      ...analysis,
      outputPath: xlsx,
      pdfPath: pdf,
    }),
  );
  expect(exported.classification).toEqual(result.classification);
  expect((await stat(xlsx)).size).toBeGreaterThan(1000);
  expect((await stat(pdf)).size).toBeGreaterThan(1000);
  execFileSync(python, [
    '-I',
    '-B',
    '-c',
    `import zipfile,lxml.etree as E,sys
z=zipfile.ZipFile(sys.argv[1]);ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
assert sheet.xpath('string(//m:c[@r="C2"]/m:v)',namespaces=ns)=='10'
assert sheet.xpath('string(//m:c[@r="B2"]/m:v)',namespaces=ns)=='3'
`,
    xlsx,
  ]);
  await copyFile(pdf, path.join(root, 'e2e/documents/.artifacts/report.pdf'));
  const evidence = await run('readPdfPages', { path: pdf, pages: [1], maxChars: 8000 });
  expect(evidence.pages[0].text).toContain('Rows: 5');
  expect(evidence.pages[0].text.replace(/\s+/g, ' ')).toContain('measurement 直径');
  const render = await done(await run('renderPdfPages', { path: pdf, pages: [1] }));
  expect((await stat(render.pages[0].path)).size).toBeGreaterThan(1000);
  const occupiedPdf = path.join(temp, 'occupied.pdf');
  await (await import('node:fs/promises')).writeFile(occupiedPdf, 'existing output');
  const unpublishedXlsx = path.join(temp, 'unpublished.xlsx');
  const rejected = await run('exportDocumentReport', {
    datasetId: result.datasetId,
    ...analysis,
    outputPath: unpublishedXlsx,
    pdfPath: occupiedPdf,
  });
  await expect(done(rejected)).rejects.toThrow('already exists');
  await expect(stat(unpublishedXlsx)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await (await import('node:fs/promises')).readFile(occupiedPdf, 'utf8')).toBe(
    'existing output',
  );
  const forbidden = await run('exportDocumentReport', {
    datasetId: result.datasetId,
    ...analysis,
    outputPath: xlsx,
  });
  let failure;
  await expect
    .poll(async () => {
      failure = await run('getDocumentJob', { jobId: forbidden.jobId });
      return failure.status;
    })
    .toBe('failed');
  expect(failure.error).toContain('already exists');
});
test('cancel heavy job then continue normal selected-file reads', async () => {
  const job = await run('analyzeSpreadsheet', {
    path: path.join(temp, 'million.xlsx'),
    columns: ['A', 'B', 'C'],
    metrics: [{ column: 'B' }],
  });
  await expect
    .poll(
      async () => {
        const state = await run('getDocumentJob', { jobId: job.jobId });
        return state.progress?.rowsScanned ?? 0;
      },
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  const cancelStarted = Date.now();
  const cancelled = await run('cancelDocumentJob', { jobId: job.jobId });
  expect(cancelled.status).toBe('cancelled');
  await expect(run('getDocumentJob', { jobId: job.jobId }, 'other-topic')).rejects.toThrow(
    /unavailable/,
  );
  const inspected = await run('inspectFile', { path: path.join(temp, 'known.xlsx') });
  expect(inspected.sheets[0].name).toBe('Data');
  expect(Date.now() - cancelStarted).toBeLessThan(5000);
});

test('Given broken DuckDB, existing Python/PPT, Office and PDF still work', async () => {
  await app.close();
  const runtime = path.join(temp, 'fault-runtime');
  await cp(path.dirname(path.dirname(python)), runtime, {
    recursive: true,
    verbatimSymlinks: true,
  });
  const packages = path.join(runtime, 'lib', 'python3.12', 'site-packages');
  await rename(path.join(packages, 'duckdb'), path.join(packages, 'duckdb-disabled'));
  await mkdir(path.join(packages, 'duckdb'));
  await writeFile(
    path.join(packages, 'duckdb', '__init__.py'),
    'raise ImportError("synthetic DuckDB loading failure")\n',
  );
  const distribution = (await readdir(packages)).find(
    (name) => name.startsWith('duckdb-') && name.endsWith('.dist-info'),
  );
  expect(distribution).toBeTruthy();
  await rename(path.join(packages, distribution), path.join(packages, distribution + '-disabled'));
  const link = path.join(root, 'e2e/documents/.artifacts/resources/python-runtime');
  await rm(link, { recursive: true, force: true });
  await symlink(runtime, link);
  try {
    app = await _electron.launch({
      executablePath: electronExecutable,
      args: [path.join(root, 'e2e/documents/.artifacts/electron-main.js')],
      env: {
        ...process.env,
        APP_URL: 'https://mlai-test.bielcrystal.com',
        MASTERINO_DOCUMENT_PROFILE: path.join(temp, 'fault-profile'),
        MASTERINO_DOCUMENT_CACHE: path.join(temp, 'fault-cache'),
        MASTERINO_DOCUMENT_WORKER: path.join(root, 'e2e/documents/.artifacts/document-worker.js'),
      },
    });
    const info = await app.evaluate(() => globalThis.getBundledPythonInfo());
    expect(info?.executable).toBeTruthy();
    expect(info.packages['python-pptx']).toBeTruthy();
    execFileSync(info.executable, [
      '-I',
      '-B',
      '-c',
      'from pptx import Presentation;import sys;p=Presentation();p.slides.add_slide(p.slide_layouts[6]);p.save(sys.argv[1]);assert len(Presentation(sys.argv[1]).slides)==1',
      path.join(temp, 'fault-legacy.pptx'),
    ]);
    const inspected = await run('inspectFile', { path: path.join(temp, 'known.xlsx') });
    expect(inspected.sheets[0].name).toBe('Data');
    const evidence = await run('readPdfPages', { path: path.join(temp, 'report.pdf'), pages: [1] });
    expect(evidence.pages[0].text).toContain('Rows: 5');
    const searched = await done(
      await run('searchPdf', { path: path.join(temp, 'report.pdf'), query: 'Rows' }),
    );
    expect(searched.matchCount).toBeGreaterThan(0);
    const rendered = await done(
      await run('renderPdfPages', { path: path.join(temp, 'report.pdf'), pages: [1] }),
    );
    expect((await stat(rendered.pages[0].path)).size).toBeGreaterThan(0);
    await expect(
      done(
        await run('analyzeSpreadsheet', {
          path: path.join(temp, 'known.xlsx'),
          columns: ['B'],
          metrics: [{ column: 'B' }],
        }),
      ),
    ).rejects.toThrow('BUNDLED_SPREADSHEET_ENGINE_UNAVAILABLE');
    // Repair only the disposable test copy; a failed optional probe must be retried.
    await rm(path.join(packages, 'duckdb'), { recursive: true, force: true });
    await rename(path.join(packages, 'duckdb-disabled'), path.join(packages, 'duckdb'));
    await rename(
      path.join(packages, distribution + '-disabled'),
      path.join(packages, distribution),
    );
    const recovered = await done(
      await run('analyzeSpreadsheet', {
        path: path.join(temp, 'known.xlsx'),
        columns: ['B'],
        metrics: [{ column: 'B' }],
      }),
    );
    expect(recovered.rowsScanned).toBe(5);
    expect(
      (
        await done(
          await run('querySpreadsheet', { datasetId: recovered.datasetId, distinct: ['B'] }),
        )
      ).sourceScans,
    ).toBe(0);
    await done(
      await run('exportDocumentReport', {
        datasetId: recovered.datasetId,
        metrics: [{ column: 'B' }],
        outputPath: path.join(temp, 'recovered.xlsx'),
      }),
    );
    expect((await app.evaluate(() => globalThis.getBundledPythonInfo()))?.executable).toBeTruthy();
  } finally {
    await app.close();
    await rm(link, { recursive: true, force: true });
    await symlink(path.dirname(path.dirname(python)), link);
  }
});

test('Given a started scan, quitting Electron reaps Python before exit', async () => {
  const runtime = path.join(temp, 'quit-runtime');
  await cp(path.dirname(path.dirname(python)), runtime, {
    recursive: true,
    verbatimSymlinks: true,
  });
  // A test-only TERM-resistant child makes the escalation/quit ordering observable.
  await writeFile(
    path.join(runtime, 'documents.py'),
    'import signal\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\n' +
      (await readFile('apps/desktop/python/documents.py', 'utf8')),
  );
  const link = path.join(root, 'e2e/documents/.artifacts/resources/python-runtime');
  await rm(link, { recursive: true, force: true });
  await symlink(runtime, link);
  app = await _electron.launch({
    executablePath: electronExecutable,
    args: [path.join(root, 'e2e/documents/.artifacts/electron-main.js')],
    env: {
      ...process.env,
      APP_URL: 'https://mlai-test.bielcrystal.com',
      MASTERINO_DOCUMENT_PROFILE: path.join(temp, 'quit-profile'),
      MASTERINO_DOCUMENT_CACHE: path.join(temp, 'quit-cache'),
      MASTERINO_DOCUMENT_WORKER: path.join(root, 'e2e/documents/.artifacts/document-worker.js'),
    },
  });
  const job = await run('analyzeSpreadsheet', {
    path: path.join(temp, 'million.xlsx'),
    columns: ['A', 'B', 'C'],
    metrics: [{ column: 'B' }],
  });
  await expect
    .poll(
      async () => (await run('getDocumentJob', { jobId: job.jobId })).progress?.rowsScanned ?? 0,
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  const processes = execFileSync('ps', ['-axo', 'pid,ppid,command'], { encoding: 'utf8' }).split(
    '\n',
  );
  const pythonPids = processes
    .filter((line) => line.includes('documents.py') && line.includes(path.join(temp, 'quit-cache')))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
  expect(pythonPids.length).toBeGreaterThan(0);
  const gone = (pid) => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
  };
  try {
    const exited = new Promise((resolve) => app.process().once('exit', resolve));
    await app.evaluate(({ app: electronApp }) => {
      setTimeout(() => electronApp.quit(), 0);
    });
    await exited;
    expect(pythonPids.every(gone)).toBe(true);
    await expect(run('inspectFile', { path: path.join(temp, 'known.xlsx') })).rejects.toThrow();
  } finally {
    for (const pid of pythonPids) if (!gone(pid)) process.kill(pid, 'SIGKILL');
    await app.close();
    await rm(link, { recursive: true, force: true });
    await symlink(path.dirname(path.dirname(python)), link);
  }
});
