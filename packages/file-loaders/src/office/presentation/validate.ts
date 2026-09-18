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
  if (
    !deck.theme ||
    !deck.theme.fonts ||
    typeof deck.theme.fonts.body !== 'string' ||
    typeof deck.theme.fonts.heading !== 'string'
  ) {
    issues.push({
      code: 'INVALID_THEME_FONT',
      message: 'Theme heading and body fonts are required',
      severity: 'error',
    });
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
    if (!slide || typeof slide !== 'object') {
      issues.push({
        code: 'INVALID_SLIDE',
        message: 'Every slide must be an object',
        severity: 'error',
      });
      continue;
    }
    if (
      typeof slide.id !== 'string' ||
      !slide.id ||
      slide.id.length > 100 ||
      slideIds.has(slide.id)
    ) {
      issues.push({
        code: 'DUPLICATE_SLIDE_ID',
        message: `Slide id must be unique: ${slide.id || '(empty)'}`,
        severity: 'error',
        slideId: slide.id,
      });
    }
    slideIds.add(slide.id);
    if (!Array.isArray(slide.elements) || slide.elements.length > 200) {
      issues.push({
        code: 'INVALID_ELEMENTS',
        message: `Slide ${slide.id} must contain at most 200 elements`,
        severity: 'error',
        slideId: slide.id,
      });
      continue;
    }
    const elementIds = new Set<string>();
    for (const element of slide.elements) {
      if (!element || typeof element !== 'object') {
        issues.push({
          code: 'INVALID_ELEMENT',
          message: 'Every presentation element must be an object',
          severity: 'error',
          slideId: slide.id,
        });
        continue;
      }
      if (
        typeof element.id !== 'string' ||
        !element.id ||
        element.id.length > 100 ||
        elementIds.has(element.id)
      ) {
        issues.push({
          code: 'DUPLICATE_ELEMENT_ID',
          elementId: element.id,
          message: `Element id must be unique within a slide: ${element.id || '(empty)'}`,
          severity: 'error',
          slideId: slide.id,
        });
      }
      elementIds.add(element.id);
      if (!['text', 'shape', 'image', 'table', 'chart'].includes(element.type)) {
        issues.push({
          code: 'INVALID_ELEMENT_TYPE',
          elementId: element.id,
          message: `Element ${element.id} has an unsupported type`,
          severity: 'error',
          slideId: slide.id,
        });
        continue;
      }
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
      if (
        element.type === 'text' &&
        (typeof element.text !== 'string' || !element.text || element.text.length > 10_000)
      ) {
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
        (!Array.isArray(element.rows) ||
          !element.rows.length ||
          element.rows.length > 100 ||
          element.rows.some(
            (row) =>
              !Array.isArray(row) ||
              !row.length ||
              row.length > 20 ||
              row.some((cell) => typeof cell !== 'string'),
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
        (!['bar', 'doughnut', 'line', 'pie'].includes(element.chartType) ||
          !Array.isArray(element.categories) ||
          !element.categories.length ||
          element.categories.some((category) => typeof category !== 'string') ||
          !Array.isArray(element.series) ||
          !element.series.length ||
          element.series.some(
            (series) =>
              !series ||
              typeof series.name !== 'string' ||
              !Array.isArray(series.values) ||
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
      if (
        element.type === 'image' &&
        (typeof element.source?.path !== 'string' || !element.source.path)
      ) {
        issues.push({
          code: 'INVALID_IMAGE',
          elementId: element.id,
          message: `Image ${element.id} needs a local source path`,
          severity: 'error',
          slideId: slide.id,
        });
      }
      if (
        element.type === 'shape' &&
        !['ellipse', 'line', 'rect', 'roundRect'].includes(element.shape)
      ) {
        issues.push({
          code: 'INVALID_SHAPE',
          elementId: element.id,
          message: `Shape ${element.id} has an unsupported geometry`,
          severity: 'error',
          slideId: slide.id,
        });
      }
      const style = 'style' in element ? element.style : undefined;
      if (style && typeof style !== 'object') {
        issues.push({
          code: 'INVALID_STYLE',
          elementId: element.id,
          message: `Element ${element.id} style must be an object`,
          severity: 'error',
          slideId: slide.id,
        });
      }
      if (style && typeof style === 'object') {
        for (const key of [
          'color',
          'fill',
          'line',
          'border',
          'headerFill',
          'headerText',
          'text',
        ] as const) {
          const value = (style as Record<string, unknown>)[key];
          if (value !== undefined && (typeof value !== 'string' || !HEX.test(value))) {
            issues.push({
              code: 'INVALID_STYLE_COLOR',
              elementId: element.id,
              message: `Element ${element.id} ${key} must be a six-digit hexadecimal color`,
              severity: 'error',
              slideId: slide.id,
            });
          }
        }
      }
      if (element.type === 'text' && typeof element.text === 'string') {
        const fontSize = element.style?.fontSize ?? 18;
        if (!Number.isFinite(fontSize) || fontSize < 6 || fontSize > 200) {
          issues.push({
            code: 'INVALID_FONT_SIZE',
            elementId: element.id,
            message: `Text element ${element.id} font size must be 6–200 pt`,
            severity: 'error',
            slideId: slide.id,
          });
        } else {
          const capacity = Math.max(
            1,
            Math.floor((element.frame.w * 72) / (fontSize * 0.55)) *
              Math.floor((element.frame.h * 72) / (fontSize * 1.2)),
          );
          if (element.text.length > capacity)
            issues.push({
              code: 'TEXT_MAY_OVERFLOW',
              elementId: element.id,
              message: `Text element ${element.id} may overflow its frame`,
              severity: 'warning',
              slideId: slide.id,
            });
        }
      }
    }
  }
  return issues;
}
