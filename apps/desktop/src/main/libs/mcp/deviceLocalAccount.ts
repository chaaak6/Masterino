import { createHash } from 'node:crypto';

import { deviceLocalMcpErrors } from '@lobechat/electron-client-ipc';
import { z } from 'zod';

import type RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';

const accountSchema = z.object({
  result: z.object({ data: z.object({ json: z.object({ userId: z.string().min(1) }) }) }),
});

const normalizeServerUrl = (url?: string | null) => url?.trim().replace(/\/+$/, '');

const hashScope = (serverUrl: string, userId: string) =>
  createHash('sha256')
    .update(JSON.stringify([serverUrl, userId]))
    .digest('hex');

export interface DeviceLocalMcpScope {
  id: string;
  matches: (stored: string) => boolean;
}

export class DeviceLocalMcpAccount {
  private cached?: { expires: number; key: string; userId: Promise<string> };

  async getScope(
    remote: RemoteServerConfigCtr,
    requestedUserId: string,
  ): Promise<DeviceLocalMcpScope> {
    const [rawServerUrl, initialToken] = await Promise.all([
      remote.getRemoteServerUrl(),
      remote.getAccessToken(),
    ]);
    const serverUrl = normalizeServerUrl(rawServerUrl);
    if (!serverUrl || !initialToken || !requestedUserId)
      throw new Error(deviceLocalMcpErrors.account);

    let token = initialToken;
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await this.getUserId(serverUrl, token).then(
        (userId) => ({ userId }),
        (error: unknown) => ({ error }),
      );
      const [currentUrl, currentToken] = await Promise.all([
        remote.getRemoteServerUrl(),
        remote.getAccessToken(),
      ]);
      if (normalizeServerUrl(currentUrl) !== serverUrl || !currentToken) break;
      if (currentToken !== token) {
        token = currentToken;
        continue;
      }
      if ('error' in outcome) throw outcome.error;
      if (outcome.userId !== requestedUserId) break;

      const id = hashScope(serverUrl, outcome.userId);
      // Read records saved before URL normalization, including after changing the trailing slash.
      const compatibleScopes = new Set([id, hashScope(`${serverUrl}/`, outcome.userId)]);
      for (const url of [rawServerUrl, currentUrl]) {
        if (url) compatibleScopes.add(hashScope(url, outcome.userId));
      }
      return { id, matches: (stored) => compatibleScopes.has(stored) };
    }
    throw new Error(deviceLocalMcpErrors.account);
  }

  private getUserId(serverUrl: string, token: string) {
    const key = createHash('sha256')
      .update(JSON.stringify([serverUrl, token]))
      .digest('hex');
    if (this.cached?.key !== key || this.cached.expires <= Date.now()) {
      const entry = {
        expires: Date.now() + 60_000,
        key,
        userId: this.fetchUserId(serverUrl, token),
      };
      this.cached = entry;
      void entry.userId.catch(() => {
        if (this.cached === entry) this.cached = undefined;
      });
    }
    return this.cached.userId;
  }

  private async fetchUserId(serverUrl: string, token: string) {
    try {
      const response = await fetch(`${serverUrl}/trpc/lambda/user.getUserState`, {
        headers: { 'Oidc-Auth': token },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 401 || response.status === 403)
        throw new Error(deviceLocalMcpErrors.account);
      if (!response.ok) throw new Error(`Account lookup failed with HTTP ${response.status}`);
      return accountSchema.parse(await response.json()).result.data.json.userId;
    } catch (cause) {
      if (cause instanceof Error && cause.message === deviceLocalMcpErrors.account) throw cause;
      throw new Error('Could not verify the desktop account with the server. Try again.', {
        cause,
      });
    }
  }
}
