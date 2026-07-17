/* eslint-disable @typescript-eslint/consistent-type-imports */
import type { HeadlessLiteXMLOperation } from '@lobehub/editor/headless';
import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';

import { EMPTY_EDITOR_STATE } from '@/libs/editor/constants';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';

export type AgentDocumentEditorData = Record<string, any>;

export type AgentDocumentLiteXMLOperation =
  | {
      action: 'insert';
      afterId: string;
      litexml: string;
    }
  | {
      action: 'insert';
      beforeId: string;
      litexml: string;
    }
  | {
      action: 'modify';
      litexml: string | string[];
    }
  | {
      action: 'remove';
      id: string;
    };

const orderLiteXMLOperations = (
  operations: AgentDocumentLiteXMLOperation[],
): AgentDocumentLiteXMLOperation[] => {
  const orderedOperations: AgentDocumentLiteXMLOperation[] = [];

  for (const operation of operations) {
    if (operation.action === 'insert') {
      orderedOperations.unshift(operation);
    } else {
      orderedOperations.push(operation);
    }
  }

  return orderedOperations;
};

const toHeadlessLiteXMLOperation = (
  operation: AgentDocumentLiteXMLOperation,
): HeadlessLiteXMLOperation => {
  switch (operation.action) {
    case 'insert': {
      return 'beforeId' in operation
        ? {
            action: 'insert',
            beforeId: operation.beforeId,
            delay: true,
            litexml: operation.litexml,
          }
        : {
            action: 'insert',
            afterId: operation.afterId,
            delay: true,
            litexml: operation.litexml,
          };
    }

    case 'modify': {
      return {
        action: 'replace',
        delay: true,
        litexml: operation.litexml,
      };
    }

    case 'remove': {
      return {
        action: 'remove',
        delay: true,
        id: operation.id,
      };
    }
  }
};

export interface AgentDocumentEditorSnapshot {
  content: string;
  editorData: AgentDocumentEditorData;
  litexml?: string;
}

const HTML_DOCUMENT_EXTENSIONS = ['.html', '.htm'];

export const isHtmlDocumentFilename = (filename?: string | null): boolean => {
  if (!filename) return false;

  const normalizedFilename = filename.trim().toLowerCase();

  return HTML_DOCUMENT_EXTENSIONS.some((extension) => normalizedFilename.endsWith(extension));
};

interface LoadEditorStateParams {
  editorData?: AgentDocumentEditorData | null;
  fallbackContent?: string;
}

const exportSnapshot = (
  editor: ReturnType<(typeof import('@lobehub/editor/headless'))['createHeadlessEditor']>,
  litexml = false,
): AgentDocumentEditorSnapshot => {
  const snapshot = editor.export({ litexml });

  return {
    content: snapshot.markdown,
    editorData: snapshot.editorData as SerializedEditorState<SerializedLexicalNode>,
    litexml: snapshot.litexml,
  };
};

const hydrateMarkdownOrEmptyState = (
  editor: ReturnType<(typeof import('@lobehub/editor/headless'))['createHeadlessEditor']>,
  content: string,
  options?: { keepId?: boolean },
) => {
  if (content.trim().length === 0) {
    editor.hydrateEditorData(
      EMPTY_EDITOR_STATE as unknown as SerializedEditorState<SerializedLexicalNode>,
      options,
    );
    return;
  }

  editor.hydrateMarkdown(content, options);
};

const loadEditorState = (
  editor: ReturnType<(typeof import('@lobehub/editor/headless'))['createHeadlessEditor']>,
  { editorData, fallbackContent = '' }: LoadEditorStateParams,
) => {
  if (isValidEditorData(editorData)) {
    editor.hydrateEditorData(
      editorData as unknown as SerializedEditorState<SerializedLexicalNode>,
      {
        keepId: true,
      },
    );
    return;
  }

  hydrateMarkdownOrEmptyState(editor, fallbackContent, { keepId: true });
};

export const createMarkdownEditorSnapshot = async (
  content: string,
): Promise<AgentDocumentEditorSnapshot> => {
  const { createHeadlessEditor } = await import('@lobehub/editor/headless');
  const editor = createHeadlessEditor();

  try {
    hydrateMarkdownOrEmptyState(editor, content);
    return exportSnapshot(editor);
  } finally {
    editor.destroy();
  }
};

/**
 * Preserve raw HTML documents byte-for-byte instead of feeding them through
 * the Markdown editor, which intentionally drops full HTML documents.
 * Non-HTML agent documents keep the existing Markdown normalization path.
 */
export const createAgentDocumentSnapshot = async (
  content: string,
  filename?: string | null,
): Promise<AgentDocumentEditorSnapshot> => {
  if (!isHtmlDocumentFilename(filename)) return createMarkdownEditorSnapshot(content);

  return {
    content,
    editorData: structuredClone(EMPTY_EDITOR_STATE) as AgentDocumentEditorData,
  };
};

export const exportEditorDataSnapshot = async (
  params: LoadEditorStateParams & { litexml?: boolean },
): Promise<AgentDocumentEditorSnapshot> => {
  const { createHeadlessEditor } = await import('@lobehub/editor/headless');
  const editor = createHeadlessEditor();

  try {
    loadEditorState(editor, params);
    return exportSnapshot(editor, params.litexml);
  } finally {
    editor.destroy();
  }
};

export const applyLiteXMLOperations = async ({
  editorData,
  fallbackContent,
  operations,
}: LoadEditorStateParams & {
  operations: AgentDocumentLiteXMLOperation[];
}): Promise<AgentDocumentEditorSnapshot> => {
  const { createHeadlessEditor } = await import('@lobehub/editor/headless');
  const editor = createHeadlessEditor();

  try {
    loadEditorState(editor, { editorData, fallbackContent });
    await editor.applyLiteXML(orderLiteXMLOperations(operations).map(toHeadlessLiteXMLOperation));
    return exportSnapshot(editor, true);
  } finally {
    editor.destroy();
  }
};
