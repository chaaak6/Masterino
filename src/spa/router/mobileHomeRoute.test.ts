// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('mobile home route', () => {
  it('renders the home page directly on the root index route', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src/spa/router/mobileRouter.config.tsx'),
      'utf8',
    );

    expect(source).toContain("element: dynamicElement(() => import('@/routes/(mobile)/(home)/')");
    expect(source).not.toContain("'Mobile > Home > Layout'");
  });
});
