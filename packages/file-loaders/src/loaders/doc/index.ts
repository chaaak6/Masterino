import fs from 'node:fs/promises';

import debug from 'debug';
import WordExtractor from 'word-extractor';

import type { DocumentPage, FileLoaderInterface } from '../../types';

const log = debug('file-loaders:doc');

const isMostlyReadableText = (content: string) => {
  if (!content.trim()) return false;

  const controlChars = [...content].filter((char) => {
    const code = char.charCodeAt(0);
    return code < 32 && char !== '\n' && char !== '\r' && char !== '\t';
  });

  return controlChars.length / content.length < 0.02;
};

const createPage = (pageContent: string): DocumentPage => {
  const lines = pageContent.split('\n');

  return {
    charCount: pageContent.length,
    lineCount: lines.length,
    metadata: { pageNumber: 1 },
    pageContent,
  };
};

/**
 * Loads legacy Word documents (.doc) using word-extractor.
 * Extracts plain text content and basic metadata from DOC files.
 */
export class DocLoader implements FileLoaderInterface {
  async loadPages(filePath: string): Promise<DocumentPage[]> {
    log('Loading DOC file:', filePath);
    try {
      const extractor = new WordExtractor();
      const extracted: any = await extractor.extract(filePath);

      // Prefer getBody() if available; fallback to common fields
      const pageContent: string =
        extracted && typeof extracted.getBody === 'function'
          ? extracted.getBody()
          : ((extracted?.text as string) ?? '');

      log('DOC loading completed');
      return [createPage(pageContent)];
    } catch (e) {
      const error = e as Error;
      log('Error encountered while loading DOC file');
      console.error(`Error loading DOC file ${filePath}: ${error.message}`);

      try {
        const textFallback = await fs.readFile(filePath, 'utf8');
        if (isMostlyReadableText(textFallback)) {
          log('DOC file parsed through readable-text fallback');
          return [createPage(textFallback)];
        }
      } catch {
        // Keep the original parser error below; it is more useful to callers.
      }

      const errorPage: DocumentPage = {
        charCount: 0,
        lineCount: 0,
        metadata: { error: `Failed to load DOC file: ${error.message}` },
        pageContent: '',
      };
      return [errorPage];
    }
  }

  async aggregateContent(pages: DocumentPage[]): Promise<string> {
    log('Aggregating content from', pages.length, 'DOC pages');
    return pages.map((p) => p.pageContent).join('\n\n');
  }
}
