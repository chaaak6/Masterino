import { randomUUID } from 'node:crypto';
import { link, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface CreateRichDocumentParams {
  paragraphs?: { text: string; heading?: boolean }[];
  path: string;
  slides?: { title: string; body: string }[];
}
/** Narrow deterministic text-only creation using pinned offline JavaScript engines. */
export async function createRichDocument(params: CreateRichDocumentParams) {
  const format = path.extname(params.path).slice(1).toLowerCase();
  if (JSON.stringify(params).length > 1024 * 1024) throw new Error('Document input exceeds 1 MiB');
  let bytes: Buffer;
  let expected: string[];
  if (format === 'docx') {
    if (
      !Array.isArray(params.paragraphs) ||
      !params.paragraphs.length ||
      params.paragraphs.length > 1000 ||
      params.paragraphs.some((p) => typeof p.text !== 'string' || p.text.length > 10_000)
    )
      throw new Error('Provide 1–1000 paragraphs, each at most 10000 characters');
    const { Document, Packer, Paragraph, HeadingLevel } = await import('docx');
    const document = new Document({
      sections: [
        {
          children: params.paragraphs.map(
            (p) =>
              new Paragraph({
                text: p.text,
                ...(p.heading && { heading: HeadingLevel.HEADING_1 }),
              }),
          ),
        },
      ],
    });
    bytes = await Packer.toBuffer(document);
    expected = params.paragraphs.map((p) => p.text);
  } else if (format === 'pptx') {
    if (
      !Array.isArray(params.slides) ||
      !params.slides.length ||
      params.slides.length > 100 ||
      params.slides.some(
        (s) =>
          typeof s.title !== 'string' ||
          typeof s.body !== 'string' ||
          s.title.length > 200 ||
          s.body.length > 3000,
      )
    )
      throw new Error('Provide 1–100 slides; title<=200 and body<=3000 characters');
    const { default: PptxGenJS } = await import('pptxgenjs');
    const presentation = new PptxGenJS();
    presentation.layout = 'LAYOUT_WIDE';
    for (const content of params.slides) {
      const slide = presentation.addSlide();
      slide.addText(content.title, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 0.8,
        fontSize: 28,
        bold: true,
        breakLine: false,
      });
      slide.addText(content.body, {
        x: 0.6,
        y: 1.5,
        w: 12.1,
        h: 5.3,
        fontSize: 18,
        valign: 'top',
        breakLine: false,
      });
    }
    const output = await presentation.write({ outputType: 'nodebuffer', compression: true });
    if (!Buffer.isBuffer(output)) throw new Error('Unexpected PowerPoint engine output');
    bytes = output;
    expected = params.slides.map((s) => s.title + s.body);
  } else throw new Error('Local creation supports xlsx, docx and pptx');
  const temp = path.join(path.dirname(params.path), `.masterino-office-${randomUUID()}.${format}`);
  try {
    await writeFile(temp, bytes, { flag: 'wx' });
    const { readOfficeDocument } = await import('./index');
    // Independent ZIP reader validates exact order and text before publishing.
    let start = 1;
    const actual: string[] = [];
    while (true) {
      const result = await readOfficeDocument({ path: temp, start, limit: 100, maxChars: 64_000 });
      actual.push(...result.records.map((r) => r.text ?? ''));
      if (!result.hasMore) break;
      start = result.next!.start!;
    }
    // PPT text runs omit the XML paragraph separator; normalize line breaks only.
    const normalized = (text: string) => text.replaceAll(/[\r\n]/g, '');
    if (
      actual.length !== expected.length ||
      expected.some((text, i) => normalized(text) !== normalized(actual[i]!))
    )
      throw new Error('Office text/order validation failed');
    await link(temp, params.path);
    const s = await stat(params.path);
    return {
      path: params.path,
      format,
      records: actual.length,
      version: `${s.size}:${s.mtimeMs}:${s.ino}`,
      validation: 'independent text and order readback; visual layout not verified',
    };
  } finally {
    await rm(temp, { force: true });
  }
}
