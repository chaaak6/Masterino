import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshot = JSON.parse(await readFile(join(root, 'snapshot.json'), 'utf8'));
// Stage beside data/ so the final rename stays on the same filesystem.
const temporary = await mkdtemp(join(root, '.data-staging-'));
try {
  const archive = process.env.LAW_ARCHIVE_PATH
    ? await readFile(process.env.LAW_ARCHIVE_PATH)
    : Buffer.from(
        await (async () => {
          const response = await fetch(
            `https://codeload.github.com/lttxzmj/chinese-law-corpus/tar.gz/${snapshot.commit}`,
            { signal: AbortSignal.timeout(120_000) },
          );
          if (!response.ok) throw new Error(`Snapshot download failed: ${response.status}`);
          return response.arrayBuffer();
        })(),
      );
  if (createHash('sha256').update(archive).digest('hex') !== snapshot.archiveSha256)
    throw new Error('Snapshot checksum mismatch');
  const archivePath = join(temporary, 'snapshot.tgz');
  await writeFile(archivePath, archive);
  const output = join(temporary, 'data');
  await mkdir(output);
  execFileSync('tar', [
    '-xzf',
    archivePath,
    '-C',
    output,
    '--strip-components=1',
    `chinese-law-corpus-${snapshot.commit}/laws`,
    `chinese-law-corpus-${snapshot.commit}/LICENSE`,
    `chinese-law-corpus-${snapshot.commit}/guiding-cases`,
    `chinese-law-corpus-${snapshot.commit}/gazette-cases`,
  ]);
  const index = JSON.parse(await readFile(join(output, 'laws/index.json'), 'utf8'));
  if (!Array.isArray(index) || !index.length) throw new Error('Empty snapshot');
  for (const item of index) {
    if (!/^[a-z0-9-]+$/.test(item.slug)) throw new Error('Invalid law slug');
    const law = JSON.parse(await readFile(join(output, 'laws', `${item.slug}.json`), 'utf8'));
    if (
      !law.title ||
      !Array.isArray(law.articles) ||
      !law.articles.every((a) => typeof a.text === 'string' && Number.isInteger(a.articleNumber))
    )
      throw new Error(`Invalid law: ${item.slug}`);
  }
  const { loadCases } = await import('../src/search.mjs');
  const cases = await loadCases(output);
  const ids = new Set();
  for (const doc of cases) {
    if (
      !/^[a-z0-9-]+$/.test(doc.id) ||
      !doc.title ||
      !doc.sourceUrl ||
      !doc.text ||
      ids.has(doc.id)
    )
      throw new Error(`Invalid or duplicate case: ${doc.id}`);
    ids.add(doc.id);
  }
  if (!cases.length) throw new Error('Empty case snapshot');
  await writeFile(
    join(output, 'snapshot.json'),
    JSON.stringify({ ...snapshot, laws: index.length, cases: cases.length }, null, 2),
  );
  await rm(join(root, 'data'), { recursive: true, force: true });
  const { rename } = await import('node:fs/promises');
  await rename(output, join(root, 'data'));
  console.info(`Prepared ${index.length} laws from ${snapshot.commit}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
