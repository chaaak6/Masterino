import { createHash } from 'node:crypto';

import { deviceLocalMcpErrors } from '@lobechat/electron-client-ipc';
import { z } from 'zod';

import type RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';

const accountSchema = z.object({
  result: z.object({ data: z.object({ json: z.object({ userId: z.string().min(1) }) }) }),
});

export class DeviceLocalMcpAccount {
  private cached?: { expires: number; key: string; userId: Promise<string> };

  async getScope(remote: RemoteServerConfigCtr, requestedUserId: string) {
    const [serverUrl, token] = await Promise.all([
      remote.getRemoteServerUrl(),
      remote.getAccessToken(),
    ]);
    if (!serverUrl || !token || !requestedUserId) throw new Error(deviceLocalMcpErrors.account);
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
    const userId = await this.cached.userId;
    const [currentUrl, currentToken] = await Promise.all([
      remote.getRemoteServerUrl(),
      remote.getAccessToken(),
    ]);
    if (userId !== requestedUserId || currentToken !== token || currentUrl !== serverUrl)
      throw new Error(deviceLocalMcpErrors.account);
    return createHash('sha256')
      .update(JSON.stringify([serverUrl, userId]))
      .digest('hex');
  }

  private async fetchUserId(serverUrl: string, token: string) {
    try {
      const response = await fetch(
        `${serverUrl.replace(/\/+$/, '')}/trpc/lambda/user.getUserState`,
        { headers: { 'Oidc-Auth': token }, redirect: 'error', signal: AbortSignal.timeout(5000) },
      );
      if (!response.ok) throw new Error();
      return accountSchema.parse(await response.json()).result.data.json.userId;
    } catch {
      throw new Error(deviceLocalMcpErrors.account);
    }
  }
}
