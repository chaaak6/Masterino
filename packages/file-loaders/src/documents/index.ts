import { spawn } from 'node:child_process';
import { mkdir, stat, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { attr, openOfficeZip } from '../office/zip';

export interface DocumentExecutionOptions {
  cacheRoot: string;
  python?: string;
  scriptPath?: string;
  signal?: AbortSignal;
  progress?: (value: unknown) => void;
  /** Desktop workers own the process group; direct callers own a separate Python group. */
  pythonProcessGroup?: boolean;
}
export async function inspectFile(params: { path: string }, options: DocumentExecutionOptions) {
  options.signal?.throwIfAborted();
  const info = await stat(params.path);
  const format = path.extname(params.path).slice(1).toLowerCase();
  const version = `${info.size}:${info.mtimeMs}:${info.ino}`;
  if (['xlsx', 'docx', 'pptx'].includes(format)) {
    const zip = await openOfficeZip(params.path, { signal: options.signal });
    try {
      const parts = [...zip.entries.values()];
      const expandedBytes = parts.reduce((n, e) => n + e.uncompressedSize, 0);
      const largestPartBytes = Math.max(0, ...parts.map((e) => e.uncompressedSize));
      const sheets =
        format === 'xlsx'
          ? [...(await zip.text('xl/workbook.xml')).matchAll(/<(?:\w+:)?sheet\s[^>]*>/g)].map(
              ([s]) => ({ name: attr(s, 'name') }),
            )
          : [];
      return {
        format,
        size: info.size,
        version,
        expandedBytes,
        largestPartBytes,
        sharedStringsBytes: zip.entries.get('xl/sharedStrings.xml')?.uncompressedSize ?? 0,
        sheets: sheets.slice(0, 100),
        sheetTotal: sheets.length,
        recommendedStrategy:
          format === 'xlsx' && (expandedBytes > 64 * 1024 ** 2 || info.size > 10 * 1024 ** 2)
            ? 'dataset'
            : 'bounded-read',
        capabilities:
          format === 'xlsx' ? ['readOfficeDocument', 'analyzeSpreadsheet'] : ['readOfficeDocument'],
        complete: true,
      };
    } finally {
      zip.close();
    }
  }
  if (format === 'pdf') {
    const { inspectPdf } = await import('./pdf');
    return { ...(await inspectPdf(params, options)), format, size: info.size, version };
  }
  return {
    format,
    size: info.size,
    version,
    recommendedStrategy: format === 'csv' ? 'dataset' : 'bounded-read',
    capabilities: format === 'csv' ? ['analyzeSpreadsheet'] : ['readFile'],
    complete: true,
  };
}
export async function executeDocumentOperation(
  operation: string,
  args: Record<string, any>,
  options: DocumentExecutionOptions,
): Promise<any> {
  options.signal?.throwIfAborted();
  await mkdir(options.cacheRoot, { recursive: true, mode: 0o700 });
  if (operation === 'inspectFile') return inspectFile(args as { path: string }, options);
  if (['readPdfPages', 'searchPdf', 'renderPdfPages'].includes(operation)) {
    const pdf = await import('./pdf');
    return pdf[operation as 'readPdfPages' | 'searchPdf' | 'renderPdfPages'](args as any, options);
  }
  if (!['analyzeSpreadsheet', 'querySpreadsheet', 'exportDocumentReport'].includes(operation))
    throw new Error('DOCUMENT_OPERATION_UNSUPPORTED');
  if (!options.python || !options.scriptPath)
    throw new Error('BUNDLED_DOCUMENT_ENGINE_UNAVAILABLE');
  const requestPath = path.join(
    options.cacheRoot,
    `request-${createHash('sha256')
      .update(JSON.stringify(args) + Date.now() + Math.random())
      .digest('hex')
      .slice(0, 24)}.json`,
  );
  const resultPath = `${requestPath}.result`;
  try {
    await writeFile(
      requestPath,
      JSON.stringify({ operation, args, cacheRoot: options.cacheRoot, resultPath }),
      { flag: 'wx', mode: 0o600 },
    );
    const env = Object.create(null) as NodeJS.ProcessEnv;
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATH', 'LANG', 'LC_ALL'])
      if (process.env[key]) env[key] = process.env[key];
    options.signal?.throwIfAborted();
    const child = spawn(
      options.python,
      ['-I', '-B', '-X', 'utf8', options.scriptPath, requestPath],
      {
        env,
        windowsHide: true,
        detached: process.platform !== 'win32' && options.pythonProcessGroup !== false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let buffer = '';
    let errorOutput = '';
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32' || options.pythonProcessGroup === false)
          child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        /* process already exited */
      }
    };
    const abort = () => {
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 500);
    };
    const timer = setTimeout(abort, 600000);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stderr.on('data', (chunk) => {
      errorOutput = (errorOutput + chunk).slice(-2000);
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop()!.slice(-4000);
      for (const line of lines) {
        try {
          options.progress?.(JSON.parse(line));
        } catch {
          /* non-protocol output */
        }
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) =>
          code === 0
            ? resolve()
            : reject(
                new Error(
                  `DOCUMENT_ENGINE_FAILED (${code ?? signal}): ${errorOutput || buffer.slice(-2000)}`,
                ),
              ),
        );
      });
      options.signal?.throwIfAborted();
    } finally {
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
    }
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    if (result.error) throw new Error(result.error);
    return result;
  } finally {
    await Promise.all([rm(requestPath, { force: true }), rm(resultPath, { force: true })]);
  }
}
