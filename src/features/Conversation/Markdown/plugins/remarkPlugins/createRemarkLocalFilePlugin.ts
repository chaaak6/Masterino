import { decodeString } from 'micromark-util-decode-string';
import { type Transformer } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

import {
  localFileQuotePairs,
  nextLocalFileAttribute,
  parseLocalFileAttributes,
} from './parseLocalFileAttributes';

function tagEnd(input: string, start: number, limit: number) {
  for (let cursor = start; cursor < limit; cursor++) {
    if (input.startsWith('/>', cursor)) return cursor;
    if (input[cursor] === '<' || input[cursor] === '>') return -1;
    if (input[cursor] !== '=') continue;

    let opener = cursor + 1;
    while (opener < limit && /\s/.test(input[opener])) opener++;
    const quote = localFileQuotePairs[input[opener]];
    if (!quote) continue;

    // Only a closed attribute can contain a literal tag terminator.
    for (let closer = opener + 1; closer < limit; closer++) {
      if (input[closer] !== quote) continue;
      const rest = input.slice(closer + 1, limit);
      if (!rest.trim() || /^\s*\/>/.test(rest) || nextLocalFileAttribute.test(rest)) {
        cursor = closer;
        break;
      }
    }
  }
  return -1;
}

export const createRemarkLocalFilePlugin =
  (tagName: string): Transformer<any> =>
  (tree, file) => {
    visit(tree, ['html', 'text', 'inlineCode'], (node, index, parent) => {
      if (!parent || typeof index !== 'number' || typeof node.value !== 'string') return;
      if (!/<localFile(?=\s|\/>)/i.test(node.value)) return;

      const text = node.type === 'text';
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      // Match and parse the same span. Markdown can decode an escaped tag into
      // node.value or consume UNC backslashes, so match indexes cannot be shared.
      const raw =
        file.value && start !== undefined && end !== undefined
          ? String(file.value).slice(start, end)
          : undefined;
      const source =
        raw !== undefined && (text || raw.replaceAll('\0', '�') === node.value) ? raw : node.value;
      const openings = [...source.matchAll(/<localFile(?=\s|\/>)/gi)];
      const replacements = [];
      let consumed = 0;
      const fragment = (value: string) => ({
        type: node.type,
        value: text ? decodeString(value) : value,
      });
      for (const [i, opening] of openings.entries()) {
        const from = opening.index;
        if (text) {
          let escapeStart = from;
          while (escapeStart > 0 && source[escapeStart - 1] === '\\') escapeStart--;
          if ((from - escapeStart) % 2) continue;
        }
        const attributesStart = from + opening[0].length;
        const limit = Math.min(openings[i + 1]?.index ?? source.length, attributesStart + 32_770);
        const close = tagEnd(source, attributesStart, limit);
        if (close < 0) continue;
        const to = close + 2;
        if (node.type === 'inlineCode' && (source.slice(0, from).trim() || source.slice(to).trim()))
          continue;
        if (from > consumed) replacements.push(fragment(source.slice(consumed, from)));
        replacements.push({
          data: {
            hName: tagName,
            hProperties: parseLocalFileAttributes(
              source.slice(attributesStart, close).trim(),
              text,
            ),
          },
          type: tagName,
        });
        consumed = to;
      }
      if (!consumed) return;
      const tail = source.slice(consumed);
      if (tail && (text || tail.trim())) replacements.push(fragment(tail));
      parent.children.splice(index, 1, ...replacements);
      return [SKIP, index + replacements.length];
    });
  };
