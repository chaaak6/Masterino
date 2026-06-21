// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('mobile SPA entry', () => {
  it('uses the debug proxy basename when loaded through the debug proxy page', async () => {
    const source = await readFile(join(process.cwd(), 'src/spa/entry.mobile.tsx'), {
      encoding: 'utf8',
    });

    expect(source).toContain("const debugProxyBase = '/_dangerous_local_dev_proxy';");
    expect(source).toContain('createAppRouter(mobileRoutes, { basename })');
  });
});
