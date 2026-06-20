import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

const readSource = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('desktop app disabled state', () => {
  it('keeps desktop app entry points visible but blocked with the shared disabled copy', () => {
    const switcher = readSource('src/features/ChatInput/ControlBar/HeteroDeviceSwitcher.tsx');
    const createPlatformAgent = readSource('src/features/CreatePlatformAgent/index.tsx');

    expect(switcher).toContain("isProductFeatureDisabled('desktopApp')");
    expect(createPlatformAgent).toContain("isProductFeatureDisabled('desktopApp')");

    expect(switcher).not.toContain('href="https://aihub.bielcrystal.com/downloads"');
    expect(createPlatformAgent).not.toContain('href="https://aihub.bielcrystal.com/downloads"');
  });

  it('records the disabled desktop app follow-up in the hot deploy handoff', () => {
    const handoff = readSource('docs/handoff/masterlion-aihub-hot-deploy-handoff-20260620.md');

    expect(handoff).toContain('desktopApp');
    expect(handoff).toContain('敬请期待');
    expect(handoff).toContain('客户端');
  });
});
