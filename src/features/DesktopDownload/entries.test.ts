import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('web desktop download entry wiring', () => {
  it.each([
    'User/UserPanel/useMenu.tsx',
    'CreatePlatformAgent/index.tsx',
    'ChatInput/ControlBar/HeteroDeviceSwitcher.tsx',
  ])('connects %s to the shared download action', (entry) => {
    const source = readFileSync(path.resolve('src/features', entry), 'utf8');
    expect(source).toContain('useDesktopDownload()');
    expect(source).toContain('void download()');
    expect(source).toContain('disabled: downloadDisabled');
    expect(source).toContain('productFeatures.disabled');
    expect(source).not.toContain('DOWNLOAD_URL');
  });
});
