import { constants, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { type BundledPythonInfo, getBundledPythonInfo } from './pythonRuntime';

interface Job {
  id: string;
  owner: string;
  operation: string;
  args: Record<string, any>;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  progress?: unknown;
  result?: any;
  error?: string;
  child?: ChildProcess;
  window?: BrowserWindow;
  timer?: ReturnType<typeof setTimeout>;
}
const background = new Set([
  'analyzeSpreadsheet',
  'querySpreadsheet',
  'searchPdf',
  'renderPdfPages',
  'exportDocumentReport',
]);
const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Device-owned job handles. Caller paths have already passed the execution boundary. */
export class DocumentJobs {
  private jobs = new Map<string, Job>();
  private datasets = new Map<string, { owner: string; path: string; createdAt: number }>();
  private active = false;
  private lastCacheSweep = 0;
  constructor(
    private readonly root: string,
    private readonly worker = path.join(__dirname, 'document-worker.js'),
  ) {
    app.once('before-quit', () => {
      for (const job of this.jobs.values()) this.stop(job);
    });
  }
  async execute(operation: string, args: Record<string, any>, owner: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!owner) throw new Error('Document jobs require a device and topic execution context');
    this.prune();
    if (operation === 'getDocumentJob' || operation === 'cancelDocumentJob') {
      const job = this.jobs.get(args.jobId);
      if (!job || job.owner !== owner)
        throw new Error('Document job is unavailable in this conversation');
      if (operation === 'cancelDocumentJob' && ['queued', 'running'].includes(job.status))
        this.stop(job);
      return this.snapshot(job);
    }
    if (
      operation === 'exportDocumentReport' &&
      (typeof args.outputPath !== 'string' ||
        path.extname(args.outputPath).toLowerCase() !== '.xlsx' ||
        (args.pdfPath && path.extname(args.pdfPath).toLowerCase() !== '.pdf'))
    )
      throw new Error('Reports require an XLSX outputPath and optional PDF pdfPath');
    if ('datasetPath' in args) throw new Error('Use the returned datasetId');
    if (operation === 'querySpreadsheet' || operation === 'exportDocumentReport') {
      const dataset = this.datasets.get(args.datasetId);
      if (!dataset || dataset.owner !== owner)
        throw new Error('Dataset is unavailable in this conversation');
      args = { ...args, datasetPath: dataset.path };
    }
    if (
      [...this.jobs.values()].filter((j) => ['queued', 'running'].includes(j.status)).length >= 20
    )
      throw new Error('Document queue is full');
    const job: Job = {
      id: randomUUID(),
      owner,
      operation,
      args,
      status: 'queued',
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    void this.drain();
    if (background.has(operation)) return this.snapshot(job);
    // Metadata and selected-page reads remain ordinary tool calls; heavy scans return handles.
    const abort = () => this.stop(job);
    signal?.addEventListener('abort', abort, { once: true });
    await new Promise<void>((resolve) => {
      const poll = () =>
        ['queued', 'running'].includes(job.status) ? setTimeout(poll, 25) : resolve();
      poll();
    });
    signal?.removeEventListener('abort', abort);
    if (job.status !== 'completed') throw new Error(job.error ?? job.status);
    return job.result;
  }
  private isCancelled(job: Job) {
    return job.status === 'cancelled';
  }
  private snapshot(job: Job) {
    return {
      jobId: job.id,
      status: job.status,
      operation: job.operation,
      progress: job.progress,
      result: job.result,
      error: job.error?.slice(0, 2000),
      next: ['queued', 'running'].includes(job.status)
        ? { api: 'getDocumentJob', jobId: job.id }
        : undefined,
    };
  }
  private prune() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, job] of this.jobs)
      if (job.createdAt < cutoff && !['queued', 'running'].includes(job.status))
        this.jobs.delete(id);
    for (const [id, dataset] of this.datasets)
      if (dataset.createdAt < cutoff) this.datasets.delete(id);
  }
  private stop(job: Job) {
    clearTimeout(job.timer);
    job.status = 'cancelled';
    if (job.child?.connected) job.child.send({ type: 'cancel' }, () => {});
    if (job.window && !job.window.isDestroyed()) job.window.destroy();
    const child = job.child;
    if (child) setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  }
  private async drain() {
    if (this.active) return;
    const job = [...this.jobs.values()].find((j) => j.status === 'queued');
    if (!job) return;
    this.active = true;
    job.status = 'running';
    const temporaryReports: string[] = [];
    const published: string[] = [];
    let budgetTimer: ReturnType<typeof setInterval> | undefined;
    job.timer = setTimeout(() => {
      this.stop(job);
      job.error = 'Document job exceeded ten minute time budget';
    }, 600000);
    try {
      await this.sweepInactiveCaches();
      const root = path.join(this.root, createHash('sha256').update(job.owner).digest('hex'));
      await mkdir(root, { recursive: true, mode: 0o700 });
      let disk = 0;
      for (const entry of await readdir(root)) {
        const file = path.join(root, entry);
        const info = await stat(file);
        if (info.isFile() && info.mtimeMs < Date.now() - 86400000) await rm(file, { force: true });
        else if (info.isFile()) disk += info.size;
        else if (entry.endsWith('.working')) await rm(file, { recursive: true, force: true });
      }
      if (disk > 4 * 1024 ** 3)
        throw new Error(
          'Document cache exceeds 4 GiB; clear the conversation cache before continuing',
        );
      budgetTimer = setInterval(() => {
        void this.cacheSize(root)
          .then((bytes) => {
            if (bytes > 4 * 1024 ** 3 && job.status === 'running') {
              this.stop(job);
              job.error = 'Document cache exceeds 4 GiB disk budget';
            }
          })
          .catch(() => {});
      }, 5000);
      const python = await getBundledPythonInfo();
      if (this.isCancelled(job)) return;
      const workerArgs = { ...job.args };
      if (job.operation === 'exportDocumentReport') {
        for (const output of [job.args.outputPath, job.args.pdfPath].filter(Boolean))
          if (await stat(output).catch(() => undefined))
            throw new Error('Report output already exists');
        workerArgs.outputPath = path.join(root, `report-${job.id}.xlsx`);
        temporaryReports.push(workerArgs.outputPath);
      }
      const result = await this.runWorker(job, job.operation, workerArgs, root, python);
      if (this.isCancelled(job)) return;
      if (result.datasetPath) {
        const existing = [...this.datasets].find(
          ([, d]) => d.owner === job.owner && d.path === result.datasetPath,
        );
        const id = existing?.[0] ?? randomUUID();
        this.datasets.set(id, {
          owner: job.owner,
          path: result.datasetPath,
          createdAt: Date.now(),
        });
        result.datasetId = id;
        delete result.datasetPath;
      }
      if (job.operation === 'exportDocumentReport') {
        if (job.args.pdfPath) {
          const temporaryPdf = path.join(root, `report-${job.id}.pdf`);
          temporaryReports.push(temporaryPdf);
          await this.printReport(temporaryPdf, result, job);
          const inspected = await this.runWorker(
            job,
            'inspectFile',
            { path: temporaryPdf },
            root,
            python,
          );
          if (inspected.pageTotal > 20) throw new Error('Report exceeds verification page budget');
          const evidence = await this.runWorker(
            job,
            'readPdfPages',
            {
              path: temporaryPdf,
              pages: Array.from({ length: inspected.pageTotal }, (_, i) => i + 1),
              maxChars: 64000,
            },
            root,
            python,
          );
          const text = evidence.pages
            .map((p: { text: string }) => p.text)
            .join(' ')
            .replace(/\s+/g, ' ');
          if (
            !evidence.complete ||
            !text.includes(`Rows: ${result.rowsScanned}`) ||
            !Object.keys(result.metrics).every((name) => text.includes(name.replace(/\s+/g, ' ')))
          )
            throw new Error('PDF report failed content verification');
          if (this.isCancelled(job)) return;
          await this.publishReport(temporaryPdf, job.args.pdfPath);
          published.push(job.args.pdfPath);
          result.pdfPath = job.args.pdfPath;
        }
        if (this.isCancelled(job)) return;
        await this.publishReport(workerArgs.outputPath, job.args.outputPath);
        published.push(job.args.outputPath);
        result.outputPath = job.args.outputPath;
      }
      job.result = result;
      job.status = 'completed';
    } catch (error) {
      if (this.isCancelled(job) && job.error) job.status = 'failed';
      if (!this.isCancelled(job)) {
        job.error = job.error ?? (error instanceof Error ? error.message : String(error));
        job.status = 'failed';
      }
    } finally {
      if (this.isCancelled(job) && job.error) job.status = 'failed';
      if (job.status !== 'completed')
        await Promise.all(published.map((file) => rm(file, { force: true })));
      await Promise.all(temporaryReports.map((file) => rm(file, { force: true })));
      clearInterval(budgetTimer);
      clearTimeout(job.timer);
      job.child = undefined;
      this.active = false;
      void this.drain();
    }
  }
  private async sweepInactiveCaches() {
    if (Date.now() - this.lastCacheSweep < 3600000) return;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const cutoff = Date.now() - 86400000;
    const sweep = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await sweep(file);
          if ((await readdir(file)).length === 0) await rm(file, { recursive: true });
        } else if (entry.isFile() && (await stat(file)).mtimeMs < cutoff) {
          await rm(file, { force: true });
        }
      }
    };
    // Jobs are serialized, so no other owner has a running parser during this sweep.
    for (const entry of await readdir(this.root, { withFileTypes: true }))
      if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
        await sweep(path.join(this.root, entry.name));
    this.lastCacheSweep = Date.now();
  }
  private async cacheSize(root: string): Promise<number> {
    let total = 0;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) total += await this.cacheSize(file);
      else total += (await stat(file).catch(() => undefined))?.size ?? 0;
    }
    return total;
  }
  private async publishReport(source: string, target: string) {
    const temporary = path.join(path.dirname(target), `.masterino-report-${randomUUID()}.tmp`);
    try {
      await copyFile(source, temporary, constants.COPYFILE_EXCL);
      // Same-directory hard-link publication is atomic and cannot overwrite an existing target.
      await link(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  private async runWorker(
    job: Job,
    operation: string,
    args: Record<string, any>,
    root: string,
    python?: BundledPythonInfo,
  ) {
    if (this.isCancelled(job)) throw new Error('cancelled');
    const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' };
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATH', 'LANG', 'LC_ALL'])
      if (process.env[key]) env[key] = process.env[key];
    return new Promise<any>((resolve, reject) => {
      const child = fork(this.worker, [], {
        env,
        execArgv: ['--max-old-space-size=512'],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      job.child = child;
      let errorOutput = '';
      child.stderr?.on('data', (data) => {
        errorOutput = (errorOutput + data).slice(-2000);
      });
      child.once('error', reject);
      child.once('exit', (code) =>
        reject(
          new Error(
            job.status === 'cancelled'
              ? 'cancelled'
              : `Document worker exited ${code}: ${errorOutput}`,
          ),
        ),
      );
      child.on('message', (message: any) => {
        if (message.type === 'progress') job.progress = message.progress;
        else if (message.type === 'result') resolve(message.result);
        else if (message.type === 'error') reject(new Error(message.error));
      });
      child.send({
        type: 'run',
        operation,
        args,
        options: {
          cacheRoot: root,
          python: python?.executable,
          scriptPath: python
            ? path.join(
                path.dirname(python.executable),
                process.platform === 'win32' ? 'documents.py' : '../documents.py',
              )
            : undefined,
        },
      });
    });
  }
  private async printReport(outputPath: string, result: any, job: Job) {
    const rows = Object.entries(result.metrics)
      .map(([name, value]) => {
        const metric = value as {
          validCount: number;
          mean?: number;
          min?: number;
          max?: number;
          stddev?: number;
          incompleteCount: number;
        };
        return `<tr>${[name, metric.validCount, metric.mean, metric.min, metric.max, metric.stddev, metric.incompleteCount].map((cell) => `<td>${escapeHtml(cell ?? 'N/A')}</td>`).join('')}</tr>`;
      })
      .join('');
    const python = await getBundledPythonInfo();
    if (!python) throw new Error('Bundled report runtime is unavailable');
    let fontPath = path.join(
      path.dirname(python.executable),
      process.platform === 'win32'
        ? 'report-fonts/LiberationSans-Regular.ttf'
        : '../report-fonts/LiberationSans-Regular.ttf',
    );
    if (/[^\u0000-\u00ff]/u.test(Object.keys(result.metrics).join(''))) {
      const candidates =
        process.platform === 'darwin'
          ? ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf']
          : [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'msyh.ttc')];
      const supported = await Promise.all(
        candidates.map(async (file) =>
          (await stat(file).catch(() => undefined))?.isFile() ? file : undefined,
        ),
      );
      const unicodeFont = supported.find(Boolean);
      if (!unicodeFont) throw new Error('A local Unicode report font is unavailable');
      fontPath = unicodeFont;
    }
    const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src https://document-report.invalid"><style>@font-face{font-family:DocumentReport;src:url(https://document-report.invalid/font)}body{font-family:DocumentReport,sans-serif;font-size:12px}td,th{padding:8px;border:1px solid #ddd}table{border-collapse:collapse;table-layout:fixed;width:100%}td{overflow-wrap:anywhere}td:first-child{width:25%}</style><h1>Document analysis</h1><p>Rows: ${result.rowsScanned}</p><p>Pass: ${result.classification.pass} · Fail: ${result.classification.fail} · Incomplete: ${result.classification.incomplete}</p><table><thead><tr>${['Metric', 'Valid', 'Mean', 'Min', 'Max', 'Sample stddev', 'Incomplete'].map((label) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><p>Incomplete measurements are excluded from numeric statistics. Sample standard deviation uses n-1. Formula values are cached.</p>`;
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: `document-report-${randomUUID()}`,
      },
    });
    job.window = win;
    const session = win.webContents.session;
    session.protocol.handle('https', (request) =>
      request.url === 'https://document-report.invalid/font'
        ? new Response(Readable.toWeb(createReadStream(fontPath)) as ReadableStream, {
            headers: { 'Content-Type': 'font/ttf' },
          })
        : new Response(null, { status: 403 }),
    );
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await win.webContents.executeJavaScript(
        'document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))',
      );
      const text = await win.webContents.executeJavaScript('document.body.innerText');
      if (!text.includes(`Rows: ${result.rowsScanned}`))
        throw new Error('Report failed layout verification');
      const bytes = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      await writeFile(outputPath, bytes, { flag: 'wx', mode: 0o600 });
      return outputPath;
    } finally {
      session.protocol.unhandle('https');
      if (!win.isDestroyed()) win.destroy();
      job.window = undefined;
    }
  }
}
