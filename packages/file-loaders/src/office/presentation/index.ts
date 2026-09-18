import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  CreatePresentationParams,
  InspectPresentationParams,
  PresentationElement,
  PresentationProject,
  PresentationResult,
  PresentationValidationResult,
  RenderPresentationPreviewParams,
  RevisePresentationParams,
  ValidatePresentationParams,
} from './types';
import { validatePresentationSpec } from './validate';

export type * from './types';
export { validatePresentationSpec } from './validate';

const versionOf = async (file: string) => {
  const value = await stat(file);
  return `${value.size}:${value.mtimeMs}:${value.ino}`;
};

async function buildPresentation(deck: CreatePresentationParams['deck']) {
  if (JSON.stringify(deck).length > 4 * 1024 * 1024) {
    throw new Error('Presentation input exceeds 4 MiB');
  }
  const issues = validatePresentationSpec(deck);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(`INVALID_PRESENTATION: ${errors[0]!.message}`);

  const { default: PptxGenJS } = await import('pptxgenjs');
  const presentation = new PptxGenJS();
  presentation.layout = deck.page?.layout === 'standard' ? 'LAYOUT_4X3' : 'LAYOUT_WIDE';
  presentation.author = deck.metadata?.author ?? 'Masterino';
  presentation.subject = deck.metadata?.subject ?? '';
  presentation.title = deck.metadata?.title ?? '';
  presentation.theme = {
    bodyFontFace: deck.theme.fonts.body,
    headFontFace: deck.theme.fonts.heading,
  };

  for (const source of deck.slides) {
    const slide = presentation.addSlide();
    slide.background = { color: source.background ?? deck.theme.colors.background };
    for (const element of source.elements) {
      const frame = element.frame;
      if (element.type === 'text') {
        slide.addText(element.text, {
          ...frame,
          bold: element.style?.bold,
          breakLine: false,
          color: element.style?.color ?? deck.theme.colors.text,
          fontFace: element.style?.fontFace ?? deck.theme.fonts.body,
          fontSize: element.style?.fontSize ?? 18,
          italic: element.style?.italic,
          margin: 0,
          valign: 'middle',
        });
      } else if (element.type === 'shape') {
        slide.addShape(presentation.ShapeType[element.shape], {
          ...frame,
          fill: {
            color: element.style?.fill ?? deck.theme.colors.accent,
            transparency: element.style?.transparency,
          },
          line: {
            color: element.style?.line ?? element.style?.fill ?? deck.theme.colors.accent,
            width: element.style?.lineWidth ?? 1,
          },
        });
      } else if (element.type === 'image') {
        slide.addImage({ ...frame, path: element.source.path });
      } else if (element.type === 'table') {
        const rows = element.rows.map((row, rowIndex) =>
          row.map((text) => ({
            options:
              rowIndex === 0
                ? {
                    bold: true,
                    color: element.style?.headerText ?? deck.theme.colors.background,
                    fill: {
                      color: element.style?.headerFill ?? deck.theme.colors.primary,
                    },
                  }
                : undefined,
            text,
          })),
        );
        slide.addTable(rows, {
          ...frame,
          border: { color: element.style?.border ?? deck.theme.colors.muted, pt: 1 },
          color: element.style?.text ?? deck.theme.colors.text,
          fill: { color: deck.theme.colors.background },
          fontFace: deck.theme.fonts.body,
          fontSize: 14,
          margin: 0.08,
          rowH: frame.h / element.rows.length,
        });
      } else if (element.type === 'chart') {
        slide.addChart(
          presentation.ChartType[element.chartType],
          element.series.map((series) => ({
            labels: element.categories,
            name: series.name,
            values: series.values,
          })),
          {
            ...frame,
            chartColors: [
              deck.theme.colors.accent,
              deck.theme.colors.primary,
              deck.theme.colors.muted,
            ],
            showLegend: element.style?.showLegend ?? element.series.length > 1,
            showTitle: element.style?.showTitle ?? false,
            title: element.style?.title,
          },
        );
      }
    }
    if (source.notes) slide.addNotes(source.notes);
  }

  const output = await presentation.write({ compression: true, outputType: 'nodebuffer' });
  if (!Buffer.isBuffer(output)) throw new Error('Unexpected PowerPoint engine output');
  return { issues, output };
}

async function assertOutputPath(outputPath: string) {
  if (path.extname(outputPath).toLowerCase() !== '.pptx') {
    throw new Error('Presentation output path must end with .pptx');
  }
}

async function publishPresentation(options: {
  outputPath: string;
  project: PresentationProject;
  projectMode: 'create' | 'replace';
  projectPath: string;
}) {
  await assertOutputPath(options.outputPath);
  const { issues, output } = await buildPresentation(options.project.deck);

  const tempId = randomUUID();
  const tempOutput = path.join(
    path.dirname(options.outputPath),
    `.masterino-presentation-${tempId}.pptx`,
  );
  const tempProject = path.join(
    path.dirname(options.projectPath),
    `.masterino-presentation-${tempId}.json`,
  );
  let outputPublished = false;
  try {
    await writeFile(tempOutput, output, { flag: 'wx' });
    await writeFile(tempProject, `${JSON.stringify(options.project, null, 2)}\n`, { flag: 'wx' });
    const { readOfficeDocument } = await import('../index');
    const readback = await readOfficeDocument({ path: tempOutput, limit: 100, maxChars: 64_000 });
    if (readback.records.length !== options.project.deck.slides.length) {
      throw new Error('Presentation slide-count validation failed');
    }
    await link(tempOutput, options.outputPath);
    outputPublished = true;
    if (options.projectMode === 'create') await link(tempProject, options.projectPath);
    else await rename(tempProject, options.projectPath);
    return {
      format: 'pptx',
      path: options.outputPath,
      presentationId: options.project.id,
      projectPath: options.projectPath,
      revision: options.project.revision,
      slides: options.project.deck.slides.length,
      validation: {
        errors: 0,
        issues,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
      },
      version: await versionOf(options.outputPath),
    } satisfies PresentationResult;
  } catch (error) {
    if (outputPublished) await rm(options.outputPath, { force: true });
    throw error;
  } finally {
    await Promise.all([rm(tempOutput, { force: true }), rm(tempProject, { force: true })]);
  }
}

export async function createPresentation(
  params: CreatePresentationParams,
): Promise<PresentationResult> {
  const project: PresentationProject = {
    deck: params.deck,
    id: randomUUID(),
    revision: 1,
    schemaVersion: 1,
  };
  return publishPresentation({
    outputPath: params.path,
    project,
    projectMode: 'create',
    projectPath: `${params.path}.masterino.json`,
  });
}

async function readProject(projectPath: string): Promise<PresentationProject> {
  const project = JSON.parse(await readFile(projectPath, 'utf8')) as PresentationProject;
  if (project.schemaVersion !== 1 || !project.id || !Number.isSafeInteger(project.revision)) {
    throw new Error('INVALID_PRESENTATION_PROJECT');
  }
  return project;
}

export async function revisePresentation(
  params: RevisePresentationParams,
): Promise<PresentationResult> {
  const current = await readProject(params.projectPath);
  if (current.revision !== params.expectedRevision) {
    throw new Error(
      `PRESENTATION_REVISION_CHANGED: expected ${params.expectedRevision}, current ${current.revision}`,
    );
  }
  if (!Array.isArray(params.operations) || params.operations.length > 500) {
    throw new Error('Presentation revision accepts at most 500 operations');
  }
  const project = structuredClone(current);
  for (const operation of params.operations) {
    if (operation.op === 'addSlide') {
      project.deck.slides.push(operation.slide);
      continue;
    }
    const slideIndex = project.deck.slides.findIndex((slide) => slide.id === operation.slideId);
    if (slideIndex < 0) throw new Error(`PRESENTATION_SLIDE_NOT_FOUND: ${operation.slideId}`);
    if (operation.op === 'removeSlide') {
      project.deck.slides.splice(slideIndex, 1);
      continue;
    }
    const slide = project.deck.slides[slideIndex]!;
    if (operation.op === 'addElement') {
      slide.elements.push(operation.element);
      continue;
    }
    const elementIndex = slide.elements.findIndex((element) => element.id === operation.elementId);
    if (elementIndex < 0) throw new Error(`PRESENTATION_ELEMENT_NOT_FOUND: ${operation.elementId}`);
    if (operation.op === 'removeElement') {
      slide.elements.splice(elementIndex, 1);
      continue;
    }
    const existing = slide.elements[elementIndex]!;
    const patch = operation.patch as Record<string, unknown>;
    if ((patch.id && patch.id !== existing.id) || (patch.type && patch.type !== existing.type)) {
      throw new Error('Presentation element id and type cannot be changed');
    }
    slide.elements[elementIndex] = { ...existing, ...patch } as PresentationElement;
  }
  project.revision++;
  return publishPresentation({
    outputPath: params.outputPath,
    project,
    projectMode: 'replace',
    projectPath: params.projectPath,
  });
}

export async function inspectPresentation(params: InspectPresentationParams) {
  const project = await readProject(params.projectPath);
  const requested = params.slideIds ? new Set(params.slideIds) : undefined;
  const selected = project.deck.slides.filter((slide) => !requested || requested.has(slide.id));
  if (
    selected.length > 20 ||
    selected.reduce((count, slide) => count + slide.elements.length, 0) > 500
  ) {
    throw new Error(
      'Presentation inspection exceeds 20 slides or 500 elements; select fewer slides',
    );
  }
  if (params.detail === 'issues') {
    return {
      issues: validatePresentationSpec(project.deck).filter(
        (issue) => !requested || !issue.slideId || requested.has(issue.slideId),
      ),
      presentationId: project.id,
      revision: project.revision,
    };
  }
  return {
    presentationId: project.id,
    revision: project.revision,
    slides: selected.map((slide, index) => ({
      elementCount: slide.elements.length,
      elementTypes: slide.elements.map((element) => element.type),
      id: slide.id,
      index: project.deck.slides.indexOf(slide) + 1 || index + 1,
      notes: Boolean(slide.notes),
      ...(params.detail === 'elements' && { elements: slide.elements }),
    })),
  };
}

export async function validatePresentation(
  params: ValidatePresentationParams,
): Promise<PresentationValidationResult> {
  const project = await readProject(params.projectPath);
  const issues = validatePresentationSpec(project.deck);
  const { openOfficeZip } = await import('../zip');
  const zip = await openOfficeZip(params.path);
  try {
    const entryNames = [...zip.entries.keys()];
    const slideParts = entryNames.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    if (slideParts.length !== project.deck.slides.length) {
      issues.push({
        code: 'PPTX_SLIDE_COUNT_MISMATCH',
        message: 'The generated PPTX slide count does not match the Masterino project',
        severity: 'error',
      });
    }
    const features = project.deck.slides.reduce(
      (result, slide) => {
        if (slide.notes) result.notes++;
        for (const element of slide.elements) {
          if (element.type === 'chart') result.charts++;
          if (element.type === 'image') result.images++;
          if (element.type === 'shape') result.shapes++;
          if (element.type === 'table') result.tables++;
        }
        return result;
      },
      { charts: 0, images: 0, notes: 0, shapes: 0, tables: 0 },
    );
    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      errors,
      features,
      issues,
      slides: slideParts.length,
      valid: errors === 0,
      warnings,
    };
  } finally {
    zip.close();
  }
}

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function elementSvg(element: PresentationElement, scale: number) {
  const { x, y, w, h } = element.frame;
  const box = { x: x * scale, y: y * scale, w: w * scale, h: h * scale };
  if (element.type === 'text') {
    const fontSize = element.style?.fontSize ?? 18;
    return `<text x="${box.x}" y="${box.y + fontSize}" font-family="${escapeXml(element.style?.fontFace ?? 'Arial')}" font-size="${fontSize}" fill="#${element.style?.color ?? '101828'}"${element.style?.bold ? ' font-weight="700"' : ''}>${escapeXml(element.text)}</text>`;
  }
  if (element.type === 'shape') {
    if (element.shape === 'line')
      return `<line x1="${box.x}" y1="${box.y}" x2="${box.x + box.w}" y2="${box.y + box.h}" stroke="#${element.style?.line ?? '2F80ED'}" />`;
    if (element.shape === 'ellipse')
      return `<ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" fill="#${element.style?.fill ?? '2F80ED'}" />`;
    return `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${element.shape === 'roundRect' ? 8 : 0}" fill="#${element.style?.fill ?? '2F80ED'}" />`;
  }
  if (element.type === 'image') {
    return `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#E4E7EC"/><text x="${box.x + 6}" y="${box.y + 18}" font-size="12">Image</text>`;
  }
  if (element.type === 'table') {
    const rows = element.rows
      .map(
        (row, rowIndex) =>
          `<text x="${box.x + 6}" y="${box.y + 18 + rowIndex * 20}" font-size="12">${escapeXml(row.join(' | '))}</text>`,
      )
      .join('');
    return `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#FFFFFF" stroke="#98A2B3"/>${rows}`;
  }
  const title = element.style?.title ?? element.series.map((series) => series.name).join(', ');
  return `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#F2F4F7" stroke="#98A2B3"/><text x="${box.x + 8}" y="${box.y + 20}" font-size="14">${escapeXml(title)}</text>`;
}

export async function renderPresentationPreview(params: RenderPresentationPreviewParams) {
  const project = await readProject(params.projectPath);
  const requested = params.slideIds ? new Set(params.slideIds) : undefined;
  const scale = 96;
  const wide = project.deck.page?.layout !== 'standard';
  const width = (wide ? 13.333 : 10) * scale;
  const height = 7.5 * scale;
  const outputDirectory = `${params.projectPath}.previews/r${project.revision}`;
  await mkdir(outputDirectory, { recursive: true });
  const slides = [];
  for (const [index, slide] of project.deck.slides.entries()) {
    if (requested && !requested.has(slide.id)) continue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#${slide.background ?? project.deck.theme.colors.background}"/>${slide.elements.map((element) => elementSvg(element, scale)).join('')}</svg>`;
    const previewPath = path.join(outputDirectory, `slide-${index + 1}-${slide.id}.svg`);
    await writeFile(previewPath, svg, 'utf8');
    slides.push({ id: slide.id, index: index + 1, path: previewPath });
  }
  return { presentationId: project.id, revision: project.revision, slides };
}
