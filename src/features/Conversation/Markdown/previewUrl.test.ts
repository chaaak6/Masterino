import { describe, expect, it } from 'vitest';

import { transformPreviewUrl } from './previewUrl';

const preview =
  'localfile://file/Users/test/document-cache/page.png?token=2ec5ea6a-4bde-4f7f-b7e7-9ff12be7ebcb';
describe('issued desktop image-preview URL boundary', () => {
  it('preserves the document preview capability only for a desktop image source', () => {
    expect(transformPreviewUrl(preview, 'src', 'img', true)).toBe(preview);
    expect(transformPreviewUrl(preview, 'href', 'a', true)).toBe('');
    expect(transformPreviewUrl(preview, 'src', 'img', false)).toBe('');
  });
  it('retains normal Markdown URLs and blocks executable or unscoped file sources', () => {
    expect(transformPreviewUrl('https://example.com/page.png', 'src', 'img', true)).toBe(
      'https://example.com/page.png',
    );
    for (const url of [
      'javascript:alert(1)',
      'file:///Users/test/page.png',
      'data:text/html,hello',
      preview.split('?')[0],
      preview.replace('file/', 'other/'),
      preview.replace('.png', '.svg'),
    ])
      expect(transformPreviewUrl(url, 'src', 'img', true)).toBe('');
  });
});
