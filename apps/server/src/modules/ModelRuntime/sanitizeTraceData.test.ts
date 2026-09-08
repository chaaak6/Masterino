// @vitest-environment node
import { expect, it } from 'vitest';

import { sanitizeTraceData } from './sanitizeTraceData';

it('handles nested image parts and embedded data URIs while retaining diagnostic metadata', () => {
  const source = {
    date: new Date(0),
    model: 'test',
    url: 'https://example.com/image.png',
    parts: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,c3ludGhldGlj' } },
      { type: 'base64', media_type: 'image/jpeg', data: 'c3ludGhldGlj' },
    ],
    error: 'Request image: data:image/webp;base64,c3ludGhldGlj; failed',
  };
  const original = structuredClone(source);
  const safe = sanitizeTraceData(source);
  expect(JSON.stringify(safe)).not.toContain('c3ludGhldGlj');
  expect(safe.error).toBe('Request image: [inline image omitted]; failed');
  expect(safe.date).toEqual(source.date);
  expect(safe.url).toBe(source.url);
  expect(safe.model).toBe(source.model);
  expect(source).toEqual(original);
});
