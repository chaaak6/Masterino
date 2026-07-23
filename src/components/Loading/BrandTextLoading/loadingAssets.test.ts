import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const loadingDuration = '2.40s';

const readAsset = (path: string) => readFileSync(resolve(root, path), 'utf8');

const getDurations = (source: string) =>
  Array.from(source.matchAll(/dur="([^"]+)"/g), (match) => match[1]);

describe('Masterino loading assets', () => {
  it.each([
    'public/brand/masterlion/loading-masterlion-en.svg',
    'public/brand/masterlion/loading-masterlion-zh.svg',
    'vi/masterlion_gray_order_loading_loop(1).svg',
    'vi/masterlion_gray_order_loading_loop(2).svg',
  ])('%s uses the fast handwriting cycle', (path) => {
    expect(new Set(getDurations(readAsset(path)))).toEqual(new Set([loadingDuration]));
  });

  it('keeps the desktop splash embedded SVG in sync with the faster cycle', () => {
    const html = readAsset('apps/desktop/resources/splash.html');
    const encodedSvg = html.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)?.[1];

    expect(encodedSvg).toBeTruthy();

    const decodedSvg = Buffer.from(encodedSvg!, 'base64').toString('utf8');

    expect(new Set(getDurations(decodedSvg))).toEqual(new Set([loadingDuration]));
  });

  it('renders the app loading wordmark large enough for the home screen', () => {
    const css = readAsset('src/components/Loading/BrandTextLoading/index.module.css');

    expect(css).toContain('width: min(320px, 72vw);');
  });

  it('renders the fullscreen loading wordmark at the same size as app loading', () => {
    const source = readAsset('src/components/Loading/FullscreenLoading/index.tsx');

    expect(source).toContain("width: 'min(320px, 72vw)'");
  });
});
