// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isValidEditorData } from '@/libs/editor/isValidEditorData';

import {
  applyLiteXMLOperations,
  createAgentDocumentSnapshot,
  createMarkdownEditorSnapshot,
  exportEditorDataSnapshot,
  isHtmlDocumentFilename,
} from './headlessEditor';

const hasNodeType = (value: unknown, type: string): boolean => {
  if (!value || typeof value !== 'object') return false;

  if (!Array.isArray(value) && 'type' in value && value.type === type) return true;

  return Object.values(value).some((child) => {
    if (Array.isArray(child)) {
      return child.some((item) => hasNodeType(item, type));
    }

    return hasNodeType(child, type);
  });
};

const getSpanId = (litexml: string, text: string): string => {
  const match = litexml.match(new RegExp(`<span id="([^"]+)">${text}</span>`));
  expect(match).not.toBeNull();

  return match![1];
};

describe('agent document headless editor', () => {
  it('should create a valid empty snapshot for whitespace-only markdown', async () => {
    const snapshot = await createMarkdownEditorSnapshot(' \n ');

    expect(snapshot.content).toBe('');
    expect(isValidEditorData(snapshot.editorData)).toBe(true);
  });

  it('should preserve complete HTML source without passing it through the markdown editor', async () => {
    const html =
      '<!doctype html>\n<html><head><title>Report</title></head><body>完整内容</body></html>';

    const snapshot = await createAgentDocumentSnapshot(html, 'report.html');

    expect(snapshot.content).toBe(html);
    expect(isValidEditorData(snapshot.editorData)).toBe(true);
  });

  it('should detect HTML extensions case-insensitively and keep markdown conversion unchanged', async () => {
    expect(isHtmlDocumentFilename('report.HTML')).toBe(true);
    expect(isHtmlDocumentFilename('report.htm')).toBe(true);
    expect(isHtmlDocumentFilename('report.md')).toBe(false);

    const snapshot = await createAgentDocumentSnapshot('# Heading', 'report.md');

    expect(snapshot.content).toContain('# Heading');
    expect(isValidEditorData(snapshot.editorData)).toBe(true);
  });

  it('should apply LiteXML operations and persist diff nodes for later human review', async () => {
    const initial = await exportEditorDataSnapshot({
      fallbackContent: 'Original',
      litexml: true,
    });
    const textId = getSpanId(initial.litexml!, 'Original');

    const snapshot = await applyLiteXMLOperations({
      editorData: initial.editorData,
      fallbackContent: initial.content,
      operations: [
        {
          action: 'modify',
          litexml: `<span id="${textId}">Updated</span>`,
        },
      ],
    });

    // Markdown and LiteXML exports are auto-normalized by the headless editor,
    // so they show the accepted view — this is what Context Engine injects and
    // what LLMs see when reading the document.
    expect(snapshot.content).toBe('Updated\n');
    expect(snapshot.litexml).toContain('Updated');

    // editorData (the persisted form) retains the diff node so the page editor
    // can render a review UI when the user next opens the document.
    expect(hasNodeType(snapshot.editorData, 'diff')).toBe(true);
  });
});
