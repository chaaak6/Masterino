import { describe, expect, it, vi } from 'vitest';

import { getUnsupportedVisualUploadType, warnUnsupportedVisualUpload } from './visualUploadGuard';

describe('getUnsupportedVisualUploadType', () => {
  it('detects images when image upload is unavailable', () => {
    const file = new File(['image'], 'sample.png', { type: 'image/png' });

    expect(
      getUnsupportedVisualUploadType(file, { canUploadImage: false, canUploadVideo: true }),
    ).toBe('image');
  });

  it('detects videos when video upload is unavailable', () => {
    const file = new File(['video'], 'sample.mp4', { type: 'video/mp4' });

    expect(
      getUnsupportedVisualUploadType(file, { canUploadImage: true, canUploadVideo: false }),
    ).toBe('video');
  });

  it('allows visual files when the matching media ability is available', () => {
    expect(
      getUnsupportedVisualUploadType(new File(['image'], 'sample.png', { type: 'image/png' }), {
        canUploadImage: true,
        canUploadVideo: false,
      }),
    ).toBeUndefined();
    expect(
      getUnsupportedVisualUploadType(new File(['video'], 'sample.mp4', { type: 'video/mp4' }), {
        canUploadImage: false,
        canUploadVideo: true,
      }),
    ).toBeUndefined();
  });

  it('does not block ordinary document files', () => {
    for (const file of [
      new File(['<html></html>'], 'page.html', { type: 'text/html' }),
      new File(['pdf'], 'doc.pdf', { type: 'application/pdf' }),
      new File(['text'], 'note.txt', { type: 'text/plain' }),
    ]) {
      expect(
        getUnsupportedVisualUploadType(file, { canUploadImage: false, canUploadVideo: false }),
      ).toBeUndefined();
    }
  });
});

describe('warnUnsupportedVisualUpload', () => {
  it('shows a localized warning when unsupported visual media is selected', () => {
    const warning = vi.fn();
    const file = new File(['image'], 'sample.png', { type: 'image/png' });

    expect(
      warnUnsupportedVisualUpload(file, {
        canUploadImage: false,
        canUploadVideo: true,
        warning,
        warningText: '当前模型不支持视觉识别。请切换模型后使用',
      }),
    ).toBe(true);

    expect(warning).toHaveBeenCalledWith('当前模型不支持视觉识别。请切换模型后使用');
  });

  it('does not warn for ordinary document files', () => {
    const warning = vi.fn();
    const file = new File(['<html></html>'], 'page.html', { type: 'text/html' });

    expect(
      warnUnsupportedVisualUpload(file, {
        canUploadImage: false,
        canUploadVideo: false,
        warning,
        warningText: '当前模型不支持视觉识别。请切换模型后使用',
      }),
    ).toBe(false);

    expect(warning).not.toHaveBeenCalled();
  });
});
