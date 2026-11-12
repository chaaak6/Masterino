import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyImageToClipboard } from './clipboard';

afterEach(() => vi.unstubAllGlobals());
describe('image clipboard content', () => {
  it('writes actual PNG bytes with an image MIME type, never the data URL text', async () => {
    let content: Record<string, Blob | Promise<Blob>> = {};
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(value: typeof content) {
          content = value;
        }
      },
    );
    const write = vi.fn().mockImplementation(async () => {
      const image = await content['image/png'];
      expect(image.type).toBe('image/png');
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    });
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })),
        ),
    );
    await copyImageToClipboard('data:image/png;base64,iVBORw==');
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('reports unsupported image clipboard instead of silently copying base64 text', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    await expect(copyImageToClipboard('data:image/png;base64,iVBORw==')).rejects.toThrow(
      'not supported',
    );
  });
});
