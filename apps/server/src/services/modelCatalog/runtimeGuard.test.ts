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

it('checks current model availability and Aihub access before every call', async () => {
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

  expect(settings).toHaveBeenCalledTimes(2);
  expect(access).toHaveBeenCalledTimes(2);
});

it('rejects a retired model even when published descriptions are disabled', async () => {
  vi.stubEnv('MASTERINO_MODEL_CATALOG_ENABLED', 'false');
  vi.spyOn(ModelCatalogRepository.prototype, 'settings').mockResolvedValue({
    availability: [
      {
        modelId: 'model-a',
        retired: true,
        updatedAt: '2026-11-27T00:00:00Z',
        updatedBy: 'admin',
        version: 1,
      },
    ],
    enabled: false,
    generation: 'test',
    silentRefreshEnabled: false,
  });
  const chat = vi.fn(async () => ({ ok: true }));
  const guarded = withCurrentModelAccess(
    { chat } as unknown as ModelRuntime,
    {} as LobeChatDatabase,
    'user',
    'newapi',
  );
  await expect((guarded as any).chat({ model: 'model-a' })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(chat).not.toHaveBeenCalled();
  await (guarded as any).chat({ model: 'model-b' });
  expect(chat).toHaveBeenCalledTimes(1);
});
