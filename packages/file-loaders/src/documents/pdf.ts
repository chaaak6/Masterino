import { createHash } from 'node:crypto';
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfModule: Promise<PdfJs> | undefined;
async function loadPdfModule() {
  return (pdfModule ??= (async () => {
    // The bundled worker has no PDF.js package-relative require path. Supply native
    // canvas primitives and the fake worker explicitly before evaluating PDF.js.
    const canvas = await import('@napi-rs/canvas');
    const globals = globalThis as unknown as Record<string, unknown>;
    for (const key of ['DOMMatrix', 'ImageData', 'Path2D'] as const) globals[key] ??= canvas[key];
    // @ts-expect-error PDF.js has no declarations for its worker implementation.
    globals.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })());
}
import type { DocumentExecutionOptions } from './index';

async function withPdf<T>(
  file: string,
  options: DocumentExecutionOptions,
  run: (pdf: PDFDocumentProxy) => Promise<T>,
) {
  const { PDFDataRangeTransport, getDocument } = await loadPdfModule();
  const handle = await open(file, 'r');
  let task: ReturnType<PdfJs['getDocument']> | undefined;
  try {
    const initialInfo = await handle.stat();
    const { size } = initialInfo;
    const initial = Buffer.alloc(Math.min(65536, size));
    const initialRead = await handle.read(initial, 0, initial.length, 0);
    class FileRange extends PDFDataRangeTransport {
      override requestDataRange(begin: number, end: number) {
        void (async () => {
          options.signal?.throwIfAborted();
          if (end - begin > 16 * 1024 ** 2)
            throw new Error('PDF range exceeds local 16 MiB read budget');
          const data = Buffer.alloc(end - begin);
          let offset = 0;
          while (offset < data.length) {
            const { bytesRead } = await handle.read(
              data,
              offset,
              data.length - offset,
              begin + offset,
            );
            if (!bytesRead) throw new Error('PDF changed while reading');
            offset += bytesRead;
          }
          this.onDataRange(begin, new Uint8Array(data));
        })().catch(() => {
          void task?.destroy();
        });
      }
    }
    const transport = new FileRange(
      size,
      new Uint8Array(initial.subarray(0, initialRead.bytesRead)),
      true,
    );
    task = getDocument({
      range: transport,
      length: size,
      disableStream: true,
      disableAutoFetch: true,
      useSystemFonts: true,
      isEvalSupported: false,
    });
    const abort = () => {
      void task?.destroy();
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      options.signal?.throwIfAborted();
      const result = await run(await task.promise);
      const after = await handle.stat();
      if (
        after.size !== initialInfo.size ||
        after.mtimeMs !== initialInfo.mtimeMs ||
        after.ctimeMs !== initialInfo.ctimeMs
      )
        throw new Error('PDF changed during processing');
      return result;
    } finally {
      options.signal?.removeEventListener('abort', abort);
    }
  } finally {
    await task?.destroy();
    await handle.close();
  }
}
const selected = (pages: number[] | undefined, total: number) => {
  const result = pages ?? [1];
  if (result.length > 20 || result.some((p) => !Number.isInteger(p) || p < 1 || p > total))
    throw new Error('Select at most 20 valid one-based PDF pages');
  return [...new Set(result)];
};
async function textFor(
  pdf: any,
  pageNumber: number,
  file: string,
  options: DocumentExecutionOptions,
) {
  options.signal?.throwIfAborted();
  const info = await stat(file);
  const key = createHash('sha256')
    .update(`${file}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${pageNumber}`)
    .digest('hex');
  const cached = path.join(options.cacheRoot, `${key}.text`);
  try {
    return await readFile(cached, 'utf8');
  } catch {
    /* first read */
  }
  const page = await pdf.getPage(pageNumber);
  try {
    const content = await page.getTextContent();
    const text = content.items
      .filter((i: any) => 'str' in i)
      .map((i: any) => i.str + (i.hasEOL ? '\n' : ' '))
      .join('')
      .replaceAll('\0', '');
    if (text.length > 2_000_000) throw new Error('PDF page text exceeds local page budget');
    await writeFile(cached, text, { mode: 0o600 });
    return text;
  } finally {
    page.cleanup();
  }
}
export async function inspectPdf(args: { path: string }, options: DocumentExecutionOptions) {
  return withPdf(args.path, options, async (pdf) => ({
    pageTotal: pdf.numPages,
    recommendedStrategy: 'selected-pages',
    capabilities: ['readPdfPages', 'searchPdf', 'renderPdfPages'],
    complete: true,
  }));
}
export async function readPdfPages(
  args: { path: string; pages?: number[]; maxChars?: number },
  options: DocumentExecutionOptions,
) {
  const maxChars = Math.min(Math.max(args.maxChars ?? 24000, 1), 64000);
  return withPdf(args.path, options, async (pdf) => {
    let remaining = maxChars;
    const pages = [];
    for (const pageNumber of selected(args.pages, pdf.numPages)) {
      const text = await textFor(pdf, pageNumber, args.path, options);
      const excerpt = text.slice(0, remaining);
      remaining -= excerpt.length;
      pages.push({
        pageNumber,
        text: excerpt,
        truncated: excerpt.length < text.length,
        needsOcr: !text.trim(),
      });
    }
    return { pages, pageTotal: pdf.numPages, complete: pages.every((p) => !p.truncated) };
  });
}
export async function searchPdf(
  args: { path: string; query: string; topK?: number },
  options: DocumentExecutionOptions,
) {
  if (!args.query?.trim() || args.query.length > 200)
    throw new Error('Provide a search phrase of 1–200 characters');
  const limit = Math.min(Math.max(args.topK ?? 20, 1), 100);
  return withPdf(args.path, options, async (pdf) => {
    const matches = [];
    let matchCount = 0;
    let emptyPages = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const text = await textFor(pdf, pageNumber, args.path, options);
      if (!text.trim()) emptyPages++;
      const lower = text.toLocaleLowerCase();
      const needle = args.query.toLocaleLowerCase();
      for (
        let offset = lower.indexOf(needle);
        offset !== -1;
        offset = lower.indexOf(needle, offset + needle.length)
      ) {
        matchCount++;
        if (matches.length < limit)
          matches.push({
            pageNumber,
            offset,
            excerpt: text.slice(Math.max(0, offset - 100), offset + needle.length + 200),
          });
      }
      options.progress?.({ phase: 'search', pagesScanned: pageNumber, pageTotal: pdf.numPages });
    }
    return {
      matches,
      matchCount,
      pageTotal: pdf.numPages,
      pagesScanned: pdf.numPages,
      emptyPages,
      needsOcr: emptyPages > 0,
      truncated: matchCount > limit,
      complete: true,
    };
  });
}
export async function renderPdfPages(
  args: { path: string; pages?: number[]; scale?: number },
  options: DocumentExecutionOptions,
) {
  const { createCanvas } = await import('@napi-rs/canvas');
  return withPdf(args.path, options, async (pdf) => {
    const pages = [];
    let pixels = 0;
    for (const pageNumber of selected(args.pages, pdf.numPages)) {
      options.signal?.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: Math.min(Math.max(args.scale ?? 1, 0.25), 2) });
        pixels += Math.ceil(viewport.width) * Math.ceil(viewport.height);
        if (pixels > 24_000_000) throw new Error('PDF render exceeds 24 million pixel budget');
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({
          canvas: canvas as any,
          canvasContext: canvas.getContext('2d') as any,
          viewport,
        }).promise;
        const outputPath = path.join(
          options.cacheRoot,
          `pdf-${createHash('sha256')
            .update(args.path + Date.now() + pageNumber)
            .digest('hex')
            .slice(0, 24)}.png`,
        );
        await writeFile(outputPath, await canvas.encode('png'), { mode: 0o600 });
        pages.push({ pageNumber, path: outputPath, width: canvas.width, height: canvas.height });
      } finally {
        page.cleanup();
      }
    }
    return { pages, pageTotal: pdf.numPages, complete: true };
  });
}
