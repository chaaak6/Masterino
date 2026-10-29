// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { socialProfileRouter } from './socialProfile';

const { mockMarketSDKHeaders } = vi.hoisted(() => ({
  mockMarketSDKHeaders: {
    Authorization: 'Bearer market-token',
  },
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  marketSDK: vi.fn((opts: any) =>
    opts.next({
      ctx: {
        ...opts.ctx,
        marketSDK: {
          headers: mockMarketSDKHeaders,
        },
      },
    }),
  ),
  marketUserInfo: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/server/modules/GitHub', () => ({
  GitHub: class {
    downloadRepoZip = vi.fn(async () => Buffer.from('repository'));
    generateIdentifier = vi.fn(() => 'lobehub-example-skill');
    parseRepoUrl = vi.fn(() => ({ branch: 'main', owner: 'lobehub', repo: 'example-skill' }));
    resolveCommit = vi.fn(async (value) => ({ ...value, branch: 'a'.repeat(40) }));
  },
}));

vi.mock('@/server/services/skill/parser', () => ({
  SkillParser: class {
    parseZipPackage = vi.fn(async () => ({
      content: 'Safe skill instructions',
      manifest: { description: 'Example', name: 'Example Skill' },
      resources: new Map(),
      skillZipBuffer: Buffer.from('skill-archive'),
      zipHash: 'b'.repeat(64),
    }));
  },
}));

describe('socialProfileRouter submissions', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MARKET_BASE_URL', 'http://masterlion-market:3220');
    fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 456 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });

  it('attributes workspace skill repo submissions to the acting organization account', async () => {
    const caller = socialProfileRouter.createCaller({ userId: 'user-1' } as any);

    await caller.submitRepo({
      actAs: 123,
      gitUrl: 'https://github.com/lobehub/example-skill',
      type: 'skill',
    });

    const call = fetchSpy.mock.calls[0] as [string, RequestInit] | undefined;
    expect(String(call?.[0])).toMatch(/\/api\/v1\/user\/skills\/lobehub-example-skill\/versions$/);
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get('x-lobe-owner-account-id')).toBe('123');
    expect(headers.has('content-type')).toBe(false);
  });

  it('creates an MCP draft and submits it to review without publishing directly', async () => {
    const caller = socialProfileRouter.createCaller({ userId: 'user-1' } as any);

    const result = await caller.submitMcp({
      authType: 'oauth2',
      description: 'Official documentation MCP',
      name: 'Documentation MCP',
      url: 'https://example.com/mcp',
    });

    const createCall = fetchSpy.mock.calls[0] as [string, RequestInit] | undefined;
    const statusCall = fetchSpy.mock.calls[1] as [string, RequestInit] | undefined;
    expect(String(createCall?.[0])).toMatch(/\/api\/v1\/user\/plugins\/user-documentation-mcp-/);
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      manifest: {
        deploymentOptions: [
          {
            connection: { auth: { type: 'oauth2' }, type: 'http', url: 'https://example.com/mcp' },
          },
        ],
        type: 'mcp',
      },
    });
    expect(JSON.parse(String(statusCall?.[1]?.body))).toEqual({ status: 'published' });
    expect(result.status).toBe('submitted');
  });
});
