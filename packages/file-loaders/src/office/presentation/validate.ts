import type { PresentationIssue, PresentationSpec } from './types';

const HEX = /^[\dA-F]{6}$/i;
const dimensions = {
  standard: { height: 7.5, width: 10 },
  wide: { height: 7.5, width: 13.333 },
};

export function validatePresentationSpec(deck: PresentationSpec): PresentationIssue[] {
  const issues: PresentationIssue[] = [];
  if (!deck || !Array.isArray(deck.slides) || deck.slides.length < 1 || deck.slides.length > 100) {
    return [
      {
        code: 'SLIDE_COUNT',
        message: 'A presentation must contain 1–100 slides',
        severity: 'error',
      },
    ];
  }
  const colors = Object.values(deck.theme?.colors ?? {});
  if (colors.length !== 5 || colors.some((color) => !HEX.test(color))) {
    issues.push({
      code: 'INVALID_THEME_COLOR',
      message: 'Theme colors must use six-digit hexadecimal values without #',
      severity: 'error',
    });
  }
  const slideIds = new Set<string>();
  const page = dimensions[deck.page?.layout ?? 'wide'];
  for (const slide of deck.slides) {
    if (!slide.id || slideIds.has(slide.id)) {
      issues.push({
        code: 'DUPLICATE_SLIDE_ID',
        message: `Slide id must be unique: ${slide.id || '(empty)'}`,
        severity: 'error',
        slideId: slide.id,
      });
    }
    slideIds.add(slide.id);
    const elementIds = new Set<string>();
    for (const element of slide.elements ?? []) {
      if (!element.id || elementIds.has(element.id)) {
        issues.push({
          code: 'DUPLICATE_ELEMENT_ID',
          elementId: element.id,
          message: `Element id must be unique within a slide: ${element.id || '(empty)'}`,
          severity: 'error',
          slideId: slide.id,
        });
      }
      elementIds.add(element.id);
      const { x, y, w, h } = element.frame ?? ({} as never);
      if (
        ![x, y, w, h].every(Number.isFinite) ||
        x < 0 ||
        y < 0 ||
        w <= 0 ||
        h <= 0 ||
        x + w > page.width + 0.001 ||
        y + h > page.height + 0.001
      ) {
        issues.push({
          code: 'ELEMENT_OUT_OF_BOUNDS',
          elementId: element.id,
          message: `Element ${element.id} must fit inside the ${deck.page?.layout ?? 'wide'} slide`,
          severity: 'error',
          slideId: slide.id,
        });
      }
      if (element.type === 'text' && (!element.text || element.text.length > 10_000)) {
        issues.push({
          code: 'INVALID_TEXT',
          elementId: element.id,
          message: `Text element ${element.id} must contain 1–10000 characters`,
          severity: 'error',
          slideId: slide.id,
        });
      }
      if (
        element.type === 'table' &&
        (!element.rows.length ||
          element.rows.length > 100 ||
          element.rows.some(
            (row) => !row.length || row.length > 20 || row.some((cell) => typeof cell !== 'string'),
          ))
      ) {
        issues.push({
          code: 'INVALID_TABLE',
          elementId: element.id,
          message: `Table ${element.id} must contain 1–100 rows and at most 20 string cells per row`,
          severity: 'error',
          slideId: slide.id,
        });
      }
      if (
        element.type === 'chart' &&
        (!element.categories.length ||
          !element.series.length ||
          element.series.some(
            (series) =>
              series.values.length !== element.categories.length ||
              series.values.some((value) => !Number.isFinite(value)),
          ))
      ) {
        issues.push({
          code: 'INVALID_CHART',
          elementId: element.id,
          message: `Chart ${element.id} needs finite values for every category`,
          severity: 'error',
          slideId: slide.id,
        });
      }
      if (element.type === 'image' && !element.source?.path) {
        issues.push({
          code: 'INVALID_IMAGE',
          elementId: element.id,
          message: `Image ${element.id} needs a local source path`,
          severity: 'error',
          slideId: slide.id,
        });
      }
    }
  }
  return issues;
}
