import { eq } from 'drizzle-orm';

import type {
  NewApiBindingItem,
  NewApiBindingStatusType,
  NewNewApiBindingItem,
} from '../schemas';
import { newApiBindings } from '../schemas';
import type { LobeChatDatabase } from '../type';

interface BaseUpsertNewApiBindingParams {
  encryptedAccessToken?: string | null;
  errorMessage?: string | null;
  managedTokenId?: number | null;
}

type UpsertActiveNewApiBindingParams = BaseUpsertNewApiBindingParams & {
  newApiUserId: number;
  status?: Exclude<NewApiBindingStatusType, 'error'>;
};

type UpsertErrorNewApiBindingParams = BaseUpsertNewApiBindingParams & {
  newApiUserId?: number | null;
  status: 'error';
};

export type UpsertNewApiBindingParams =
  | UpsertActiveNewApiBindingParams
  | UpsertErrorNewApiBindingParams;

const isValidNewApiUserId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export interface UpdateNewApiBindingSyncStateParams {
  errorMessage?: string | null;
  lastSyncedAt?: Date | null;
  managedTokenId?: number | null;
  status: NewApiBindingStatusType;
}

export class NewApiBindingModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  find = async (): Promise<NewApiBindingItem | undefined> => {
    return this.db.query.newApiBindings.findFirst({
      where: eq(newApiBindings.userId, this.userId),
    });
  };

  upsert = async (params: UpsertNewApiBindingParams) => {
    const now = new Date();
    const status = params.status ?? 'pending';

    if (status !== 'error' && !isValidNewApiUserId(params.newApiUserId)) {
      throw new Error('newApiUserId is required for non-error NewAPI bindings');
    }

    const values: NewNewApiBindingItem = {
      encryptedAccessToken: params.encryptedAccessToken ?? null,
      errorMessage: params.errorMessage ?? null,
      managedTokenId: params.managedTokenId ?? null,
      newApiUserId: params.newApiUserId ?? null,
      status,
      updatedAt: now,
      userId: this.userId,
    };

    return this.db
      .insert(newApiBindings)
      .values(values)
      .onConflictDoUpdate({
        set: {
          encryptedAccessToken: values.encryptedAccessToken,
          errorMessage: values.errorMessage,
          managedTokenId: values.managedTokenId,
          newApiUserId: values.newApiUserId,
          status: values.status,
          updatedAt: now,
        },
        target: newApiBindings.userId,
      })
      .returning();
  };

  updateSyncState = async (params: UpdateNewApiBindingSyncStateParams) => {
    return this.db
      .update(newApiBindings)
      .set({
        errorMessage: params.errorMessage ?? null,
        lastSyncedAt: params.lastSyncedAt ?? new Date(),
        managedTokenId: params.managedTokenId ?? null,
        status: params.status,
        updatedAt: new Date(),
      })
      .where(eq(newApiBindings.userId, this.userId));
  };
}
