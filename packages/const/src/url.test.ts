import { describe, expect, it } from 'vitest';

import {
  AGENTS_INDEX_GITHUB,
  FEEDBACK,
  GITHUB,
  GITHUB_ISSUES,
  MORE_FILE_PREVIEW_REQUEST_URL,
  MORE_MODEL_PROVIDER_REQUEST_URL,
  RELEASES_URL,
} from './url';

describe('MasterLion public repository URLs', () => {
  it('uses the MasterLion GitHub repository for product links', () => {
    expect(GITHUB).toBe('https://github.com/chaaak6/MasterLion');
    expect(GITHUB_ISSUES).toBe('https://github.com/chaaak6/MasterLion/issues/new/choose');
    expect(FEEDBACK).toBe(GITHUB_ISSUES);
    expect(MORE_MODEL_PROVIDER_REQUEST_URL).toBe(GITHUB_ISSUES);
    expect(MORE_FILE_PREVIEW_REQUEST_URL).toBe(GITHUB_ISSUES);
    expect(AGENTS_INDEX_GITHUB).toBe(GITHUB);
    expect(RELEASES_URL).toBe('https://github.com/chaaak6/MasterLion/releases');
  });
});
