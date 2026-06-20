import type { NewApiLogItem, NewApiPage, NewApiToken, NewApiUser } from './client';
import { NewApiBridgeClient } from './bridgeClient';
import { NewApiReadOnlyDb } from './readOnlyDb';

export interface NewApiReadSource {
  findManagedToken(userId: number, tokenName: string): Promise<NewApiToken | undefined>;
  findUserById(userId: number): Promise<NewApiUser | undefined>;
  findUserByIdentity(identity: {
    email?: string;
    username?: string;
  }): Promise<NewApiUser | undefined>;
  getUsageLogs(
    userId: number,
    params?: {
      endTimestamp?: number;
      page?: number;
      pageSize?: number;
      startTimestamp?: number;
    },
  ): Promise<NewApiPage<NewApiLogItem>>;
  isEnabled(): boolean;
  listAccessibleModels(group?: string, token?: NewApiToken): Promise<string[]>;
  listManagedTokens(userId: number, tokenName: string): Promise<NewApiToken[]>;
}

export const getNewApiDataSource = () => (process.env.AIHUB_DATA_SOURCE || 'hybrid').toLowerCase();

export const createNewApiReadSource = (): NewApiReadSource => {
  if (getNewApiDataSource() === 'bridge') return new NewApiBridgeClient();

  return new NewApiReadOnlyDb();
};
