// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOBE_CHAT_OIDC_AUTH_HEADER } from '@/envs/auth';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  downloadSkill: vi.fn(),
  getSession: vi.fn(),
  marketServiceConstructor: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/user', () => ({
  UserModel: { findById: vi.fn().mockResolvedValue({ email: 'qa@example.com', fullName: 'QA' }) },
}));
vi.mock('@/libs/oidc-provider/jwt', () => ({
  validateOIDCJWT: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));
vi.mock('@/libs/oidc-provider/access-control', () => ({ assertOIDCUserActive: vi.fn() }));

vi.mock('@/server/services/market', () => ({
  MarketService: mocks.marketServiceConstructor.mockImplementation(() => ({
    downloadSkill: mocks.downloadSkill,
  })),
}));

describe('Market skill archive download route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.downloadSkill.mockResolvedValue({
      buffer: Buffer.from('skill-archive'),
      filename: 'office-documents.zip',
    });
  });

  it('requires an authenticated user', async () => {
    mocks.getSession.mockResolvedValue(undefined);

    const response = await GET(new Request('https://example.com/api/market/download'), {
      params: Promise.resolve({ identifier: 'office-documents' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.marketServiceConstructor).not.toHaveBeenCalled();
  });

  it.each(['web', 'desktop'])(
    'downloads through the trusted server-side Market client with %s authentication',
    async (mode) => {
      const response = await GET(
        new Request('https://example.com/api/market/download?version=1.2.3', {
          headers: mode === 'desktop' ? { [LOBE_CHAT_OIDC_AUTH_HEADER]: 'test-oidc' } : {},
        }),
        {
          params: Promise.resolve({ identifier: 'office-documents' }),
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/zip');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(mocks.marketServiceConstructor).toHaveBeenCalledWith({
        userInfo: { userId: 'user-1', email: 'qa@example.com', name: 'QA' },
      });
      expect(mocks.downloadSkill).toHaveBeenCalledWith('office-documents', '1.2.3');
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('skill-archive');
    },
  );
});
