// @vitest-environment node
import type { ModelRuntime } from '@lobechat/model-runtime';
import { afterEach, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { NewApiService } from '@/server/services/newApi';

import { ModelCatalogRepository } from './repository';
import { withCurrentModelAccess } from './runtimeGuard';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('shares a short settings read while checking Aihub access before every call', async () => {
  vi.stubEnv('AIHUB_PROXY_URL', 'http://localhost:19327');
  vi.stubEnv('KEY_VAULTS_SECRET', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  const settings = vi.spyOn(ModelCatalogRepository.prototype, 'settings').mockResolvedValue({
    enabled: true,
    generation: 'test',
    silentRefreshEnabled: true,
  });
  const access = vi
    .spyOn(NewApiService.prototype, 'assertCurrentModelAccess')
    .mockResolvedValue(undefined);
  const runtime = { chat: vi.fn(async () => ({ ok: true })) } as unknown as ModelRuntime;
  const guarded = withCurrentModelAccess(runtime, {} as LobeChatDatabase, 'user', 'newapi', 'key');

  await (guarded as any).chat({ model: 'model-a' });
  await (guarded as any).chat({ model: 'model-a' });

  expect(settings).toHaveBeenCalledTimes(1);
  expect(access).toHaveBeenCalledTimes(2);
});
