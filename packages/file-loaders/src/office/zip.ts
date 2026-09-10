import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import * as yauzl from 'yauzl';

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
const xmlQualifiedNamePattern = (tag: string) =>
  tag.includes(':') ? escapeRegExp(tag) : `(?:[A-Za-z_][\\w.-]*:)?${escapeRegExp(tag)}`;

/** Opens only requested ZIP members; never expands the whole Office package. */
export async function openOfficeZip(path: string, options: { signal?: AbortSignal } = {}) {
  const { signal } = options;
  signal?.throwIfAborted();
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(path, { autoClose: false, lazyEntries: true }, (e, z) =>
      e ? reject(e) : resolve(z!),
    ),
  );
  const entries = new Map<string, yauzl.Entry>();
  try {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal?.reason);
      const finish = (error?: Error) => {
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve();
      };
      signal?.addEventListener('abort', abort, { once: true });
      zip.on('error', finish);
      zip.on('end', () => finish());
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entries.size >= 20_000) {
          finish(new Error('Office package has too many parts'));
          return;
        }
        entries.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.readEntry();
    });
  } catch (e) {
    zip.close();
    throw e;
  }
  async function* chunks(name: string) {
    signal?.throwIfAborted();
    const entry = entries.get(name);
    if (!entry) throw new Error(`Missing Office part: ${name}`);
    if (entry.uncompressedSize > 1024 * 1024 * 1024)
      throw new Error('Office part exceeds 1 GiB scan limit');
    const stream = await new Promise<Readable>((resolve, reject) =>
      zip.openReadStream(entry, (e, s) => (e ? reject(e) : resolve(s!))),
    );
    const abort = () => stream.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      const decoder = new StringDecoder('utf8');
      for await (const chunk of stream) {
        signal?.throwIfAborted();
        yield decoder.write(chunk as Buffer);
      }
      signal?.throwIfAborted();
      yield decoder.end();
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      stream.destroy();
    }
  }
  async function text(name: string, limit = 4 * 1024 * 1024) {
    let out = '';
    for await (const chunk of chunks(name)) {
      out += chunk;
      if (out.length > limit) throw new Error(`Office metadata exceeds ${limit} characters`);
    }
    return out;
  }
  async function* records(name: string, tag: string) {
    let buffer = '';
    const start = new RegExp(`<(${xmlQualifiedNamePattern(tag)})(?:\\s[^>]*|)>`);
    for await (const chunk of chunks(name)) {
      buffer += chunk;
      while (true) {
        signal?.throwIfAborted();
        const match = start.exec(buffer);
        if (!match) {
          if (buffer.length > 1_000_000) buffer = buffer.slice(-1000);
          break;
        }
        buffer = buffer.slice(match.index);
        const end = `</${match[1]}>`;
        const stop = buffer.indexOf(end);
        if (stop < 0) break;
        yield buffer.slice(0, stop + end.length);
        buffer = buffer.slice(stop + end.length);
      }
      if (buffer.length > 2 * 1024 * 1024) throw new Error('Office record exceeds 2 MiB limit');
    }
  }
  return { close: () => zip.close(), entries, records, text };
}
export const unescapeXml = (s: string) =>
  s.replaceAll(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, x: string) => {
    if (x.startsWith('#'))
      return String.fromCodePoint(x[1] === 'x' ? parseInt(x.slice(2), 16) : Number(x.slice(1)));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[x] ?? _;
  });
export const attr = (xml: string, key: string) =>
  unescapeXml(new RegExp(`(?:\\s)${key}=["']([^"']*)["']`).exec(xml)?.[1] ?? '');
export const textNodes = (xml: string, prefix = '(?:\\w+:)?') =>
  [...xml.matchAll(new RegExp(`<${prefix}t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${prefix}t>`, 'g'))]
    .map((m) => unescapeXml(m[1]!))
    .join('');
