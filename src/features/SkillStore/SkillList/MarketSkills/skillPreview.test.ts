// @vitest-environment node
import { strToU8, zipSync } from 'fflate';
import { expect, it, vi } from 'vitest';

import { fetchZipContents } from './skillPreview';

it('preserves all resource paths while decoding bounded script/text previews only', async () => {
  const archive = zipSync({
    'wrapped/SKILL.md': strToU8('# Demo'),
    'wrapped/README.md': strToU8('Read before install'),
    'wrapped/scripts/generate.py': strToU8('print("preview")'),
    'wrapped/scripts/run.sh': strToU8('echo preview'),
    'wrapped/scripts/index.js': strToU8('console.log("preview")'),
    'wrapped/scripts/large.py': new Uint8Array(256 * 1024 + 1),
    'wrapped/image.png': new Uint8Array([137, 80, 78, 71]),
  });
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(archive));
  try {
    const { contentMap, tree } = await fetchZipContents('https://test.invalid/skill.zip');
    expect(contentMap['scripts/generate.py']).toBe('print("preview")');
    expect(contentMap['scripts/run.sh']).toBe('echo preview');
    expect(contentMap['scripts/index.js']).toBe('console.log("preview")');
    expect(contentMap['SKILL.md']).toBe('# Demo');
    expect(tree.map((file) => file.path).sort()).toEqual([
      'README.md',
      'image.png',
      'scripts/generate.py',
      'scripts/index.js',
      'scripts/large.py',
      'scripts/run.sh',
    ]);
    expect(contentMap['image.png']).toBeUndefined();
    expect(contentMap['scripts/large.py']).toBeUndefined();
  } finally {
    request.mockRestore();
  }
});
