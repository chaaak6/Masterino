import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('SPA boot loading template', () => {
  it('uses the Masterion handwriting loading asset before React mounts', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');

    expect(html).toContain('/brand/masterlion/loading-masterlion-zh.svg');
    expect(html).toContain('width: min(320px, 72vw);');
    expect(html).not.toContain('<title>LobeHub</title>');
    expect(html).not.toContain('viewBox="0 0 940 320"');
  });
});
