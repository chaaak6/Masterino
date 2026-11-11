import { decodeString } from 'micromark-util-decode-string';

// Recover bounded display wrappers without applying shell or URL decoding.
export const localFileQuotePairs: Record<string, string> = {
  '"': '"',
  "'": "'",
  '“': '”',
  '‘': '’',
  '「': '」',
  '『': '』',
};
const quotes = new Set([
  ...Object.keys(localFileQuotePairs),
  ...Object.values(localFileQuotePairs),
]);
export const nextLocalFileAttribute = /^\s+[a-z][\w-]*\s*=|^\s+isDirectory(?=\s|$)/i;
const isBoundary = (rest: string) => !rest.trim() || nextLocalFileAttribute.test(rest);
const isRooted = (value: string) => /^(?:\/|~[\\/]|[a-z]:[\\/]|\\\\|\.{1,2}[\\/])/i.test(value);

function unwrap(value: string, isPath: boolean) {
  let result = value.trim();
  const first = result[0];
  if (
    localFileQuotePairs[first] &&
    result.endsWith(localFileQuotePairs[first]) &&
    result.length >= 2
  ) {
    result = result.slice(1, -1);
  } else if (quotes.has(first)) {
    // Repair unmatched/mixed wrappers only for an unmistakable path root.
    const withoutPrefix = result.replace(/^["'“”‘’「」『』]+/, '');
    if (!isPath || isRooted(withoutPrefix)) {
      result = withoutPrefix.replace(/["'“”‘’「」『』]+$/, '');
    }
  }
  if (isPath && quotes.has(result[0])) {
    const withoutPrefix = result.replace(/^["'“”‘’「」『』]+/, '');
    if (isRooted(withoutPrefix)) result = withoutPrefix.replace(/["'“”‘’「」『』]+$/, '');
  }
  return result;
}

export function parseLocalFileAttributes(
  input: string,
  markdownText = false,
): Record<string, string | boolean> {
  const attributes: Record<string, string | boolean> = {};
  if (input.length > 32768) return attributes;
  const seen = new Set<string>();
  let ambiguousPath = false;
  let cursor = 0;
  while (cursor < input.length) {
    const key = /^\s*([a-z][\w-]*)\s*(=\s*)?/i.exec(input.slice(cursor));
    if (!key) break; // Unknown/ambiguous syntax is not a new filesystem path.
    cursor += key[0].length;
    const keyName = key[1].toLowerCase();
    const field = keyName === 'isdirectory' ? 'isDirectory' : keyName;
    if (seen.has(field) && field === 'path') ambiguousPath = true;
    seen.add(field);
    if (!key[2]) {
      if (field === 'isDirectory') attributes[field] = true;
      continue;
    }
    const start = cursor;
    const opener = input[cursor];
    let end = -1;
    if (localFileQuotePairs[opener]) {
      // A quote closes only at an attribute/end boundary. Apostrophes and
      // attribute-looking strings *inside* a quoted filename stay literal.
      for (let i = cursor + 1; i < input.length; i++) {
        if (input[i] === localFileQuotePairs[opener] && isBoundary(input.slice(i + 1))) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) {
      end = input.length;
      for (let i = start; i < input.length; i++) {
        const tail = input.slice(i);
        if (nextLocalFileAttribute.test(tail)) {
          // Without a closing quote, an unknown assignment could be part of
          // the filename. Never pass a shortened path to the OS.
          if (field === 'path' && !/^\s+(?:name|path|isDirectory)\b/i.test(tail)) {
            ambiguousPath = true;
          }
          end = i;
          break;
        }
      }
    }
    let value = unwrap(input.slice(start, end), field === 'path');
    // An unmatched ASCII delimiter inside a repaired path can indicate that
    // a missing quote swallowed the next attribute. Do not open a guess.
    if (
      field === 'path' &&
      (opener === '"' || opener === "'") &&
      /\s+[a-z][\w-]*\s*=\s*["']/i.test(value) &&
      [...value].filter((character) => character === opener).length % 2 !== 0
    )
      ambiguousPath = true;
    // Preserve Windows path separators while applying Markdown text escapes
    // to POSIX paths. HTML and code values only decode character references.
    const windowsPath =
      /^[a-z]:[\\/]/i.test(value) || (!/^(?:\/|~\/|\.{1,2}\/)/.test(value) && value.includes('\\'));
    if (markdownText && !(field === 'path' && windowsPath)) {
      value = decodeString(value);
    } else {
      value = value.replaceAll(/&(?:#x[\da-f]+|#\d+|[a-z]\w*);/gi, (reference) =>
        decodeString(reference),
      );
    }
    if (field === 'name' || field === 'path') attributes[field] = value;
    if (field === 'isDirectory') attributes[field] = value === 'true';
    cursor = end;
  }
  const value = attributes.path;
  if (
    ambiguousPath ||
    typeof value !== 'string' ||
    !value.trim() ||
    [...value].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value))
  )
    delete attributes.path;
  return attributes;
}
