// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('debug proxy HTML', () => {
  it('selects mobile server config and Vite entry when browser devtools emulates a phone', async () => {
    const html = await readFile(join(process.cwd(), 'public/_dangerous_local_dev_proxy.html'), {
      encoding: 'utf8',
    });

    expect(html).toContain('isMobileDebugLayout');
    expect(html).toContain("locale + '__' + (isMobileDebugLayout ? '1' : '0')");
    expect(html).toContain("host + (isMobileDebugLayout ? '/index.mobile.html' : '/')");
  });
});
