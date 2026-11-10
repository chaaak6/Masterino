// Model-generated localFile tags are not HTML: accept bounded display wrappers,
// but never shell-unescape, URI-decode, or rewrite filesystem characters.
const quotePairs: Record<string, string> = {
  '"': '"',
  "'": "'",
  '“': '”',
  '‘': '’',
  '「': '」',
  '『': '』',
};
const quotes = new Set([...Object.keys(quotePairs), ...Object.values(quotePairs)]);
const nextAttribute = /^\s+(?:name|path)\s*=|^\s+isDirectory(?=\s|$)/;
const isBoundary = (rest: string) => !rest.trim() || nextAttribute.test(rest);
const isRooted = (value: string) => /^(?:\/|~[\\/]|[a-z]:[\\/]|\\\\|\.{1,2}[\\/])/i.test(value);

function unwrap(value: string, isPath: boolean) {
  let result = value.trim();
  const first = result[0];
  if (quotePairs[first] && result.endsWith(quotePairs[first]) && result.length >= 2) {
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

export function parseLocalFileAttributes(input: string): Record<string, string | boolean> {
  const attributes: Record<string, string | boolean> = {};
  if (input.length > 32768) return attributes;
  const seen = new Set<string>();
  let ambiguousPath = false;
  let cursor = 0;
  while (cursor < input.length) {
    const key = /^\s*(name|path|isDirectory)\b\s*(=\s*)?/.exec(input.slice(cursor));
    if (!key) break; // Unknown/ambiguous syntax is not a new filesystem path.
    cursor += key[0].length;
    const field = key[1];
    if (seen.has(field) && field === 'path') ambiguousPath = true;
    seen.add(field);
    if (!key[2]) {
      if (field === 'isDirectory') attributes[field] = true;
      continue;
    }
    const start = cursor;
    const opener = input[cursor];
    let end = -1;
    if (quotePairs[opener]) {
      // A quote closes only at an attribute/end boundary. Apostrophes and
      // attribute-looking strings *inside* a quoted filename stay literal.
      for (let i = cursor + 1; i < input.length; i++) {
        if (input[i] === quotePairs[opener] && isBoundary(input.slice(i + 1))) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) {
      end = input.length;
      for (let i = start; i < input.length; i++) {
        if (nextAttribute.test(input.slice(i))) {
          end = i;
          break;
        }
      }
    }
    const value = unwrap(input.slice(start, end), field === 'path');
    // An unmatched ASCII delimiter inside a repaired path can indicate that
    // a missing quote swallowed the next attribute. Do not open a guess.
    if (
      field === 'path' &&
      (opener === '"' || opener === "'") &&
      /\s+(?:name|path)\s*=\s*["']/.test(value) &&
      [...value].filter((character) => character === opener).length % 2 !== 0
    )
      ambiguousPath = true;
    attributes[field] = field === 'isDirectory' ? value === 'true' : value;
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
