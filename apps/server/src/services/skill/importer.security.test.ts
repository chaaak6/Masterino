// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillImportError } from './errors';
import { SkillImporter } from './importer';

const { mockSsrfSafeFetch } = vi.hoisted(() => ({
  mockSsrfSafeFetch: vi.fn(),
}));

vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: mockSsrfSafeFetch,
}));

vi.mock('@/server/modules/GitHub', () => ({
  GitHub: vi.fn(() => ({})),
  GitHubNotFoundError: class GitHubNotFoundError extends Error {},
  GitHubParseError: class GitHubParseError extends Error {},
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({})),
}));

vi.mock('./parser', () => ({
  SkillParser: vi.fn(() => ({})),
}));

vi.mock('./resource', () => ({
  SkillResourceService: vi.fn(() => ({})),
}));

const createImporter = () => new SkillImporter({} as LobeChatDatabase, 'user-1');

describe('SkillImporter remote URL security', () => {
  beforeEach(() => {
    vi.stubEnv('SKILL_IMPORT_ALLOWED_ORIGINS', 'https://skills.example.com');
    mockSsrfSafeFetch.mockReset();
  });

  it.each([
    'http://127.0.0.1:3210/api/auth/get-session',
    'http://100.100.100.200/latest/meta-data/',
    'file:///etc/passwd',
    'https://user:password@example.com/skill.md',
  ])('rejects unsafe URL %s before any outbound request', async (url) => {
    const importer = createImporter();

    await expect(importer.importFromUrl({ url })).rejects.toMatchObject({
      code: 'INVALID_URL',
    });
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it('uses strict SSRF filtering and hides blocked network details', async () => {
    const importer = createImporter();
    mockSsrfSafeFetch.mockRejectedValueOnce(
      new Error(
        'SSRF blocked: DNS lookup 127.0.0.1 is not allowed. Because, It is private IP address.',
      ),
    );

    let error: SkillImportError | undefined;
    try {
      await importer.importFromUrl({ url: 'https://skills.example.com/SKILL.md' });
    } catch (caughtError) {
      error = caughtError as SkillImportError;
    }

    expect(error).toBeInstanceOf(SkillImportError);
    expect(error).toMatchObject({
      code: 'DOWNLOAD_FAILED',
      message: 'Failed to process remote skill',
    });
    expect(error?.message).not.toContain('127.0.0.1');
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      'https://skills.example.com/SKILL.md',
      { signal: expect.any(AbortSignal) },
      {
        allowIPAddressList: [],
        allowPrivateIPAddress: false,
        allowedURLOrigins: ['https://skills.example.com'],
        maxContentLength: 16 * 1024 * 1024,
      },
    );
  });

  it('rejects a public HTTPS origin that is not explicitly approved', async () => {
    const importer = createImporter();

    await expect(
      importer.importFromUrl({ url: 'https://untrusted.example.com/SKILL.md' }),
    ).rejects.toMatchObject({
      code: 'INVALID_URL',
      message: 'Remote skill source is not approved',
    });
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it('rejects redirects to an origin outside the allowlist', async () => {
    const importer = createImporter();
    mockSsrfSafeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: 'https://untrusted.example.com/SKILL.md',
    });

    await expect(
      importer.importFromUrl({ url: 'https://skills.example.com/SKILL.md' }),
    ).rejects.toMatchObject({
      code: 'INVALID_URL',
      message: 'Remote skill redirect target is not approved',
    });
  });
});
