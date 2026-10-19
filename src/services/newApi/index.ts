import type {
  AihubRebindResult,
  NewApiAccountSummary,
  NewApiBindingImportResult,
  NewApiBindingImportRow,
  NewApiBindingStatus,
  NewApiUsageSummary,
} from '@lobechat/types';

import { MANUAL_MODEL_REFRESH_EVENT } from '@/features/SilentModelRefresh/controller';
import { lambdaClient } from '@/libs/trpc/client';

class AihubService {
  private modelSyncsInFlight = 0;
  getSubscriptionSummary = () => lambdaClient.aihub.getSubscriptionSummary.query();

  getAccountSummary = async (): Promise<NewApiAccountSummary> => {
    return lambdaClient.aihub.getAccountSummary.query();
  };

  getBindingStatus = async (): Promise<NewApiBindingStatus> => {
    return lambdaClient.aihub.getBindingStatus.query();
  };

  getUsageSummary = async (params?: {
    endTimestamp?: number;
    startTimestamp?: number;
  }): Promise<NewApiUsageSummary> => {
    return lambdaClient.aihub.getUsageSummary.query(params);
  };

  rebindCurrentUser = async (): Promise<AihubRebindResult> => {
    return lambdaClient.aihub.rebindCurrentUser.mutate();
  };

  importBindings = async (rows: NewApiBindingImportRow[]): Promise<NewApiBindingImportResult[]> => {
    return lambdaClient.aihub.importBindings.mutate({ rows });
  };

  syncModels = async () => {
    if (typeof window !== 'undefined' && this.modelSyncsInFlight === 0)
      window.dispatchEvent(new CustomEvent(MANUAL_MODEL_REFRESH_EVENT, { detail: true }));
    this.modelSyncsInFlight++;
    try {
      return await lambdaClient.aihub.syncModels.mutate();
    } finally {
      this.modelSyncsInFlight--;
      if (typeof window !== 'undefined' && this.modelSyncsInFlight === 0)
        window.dispatchEvent(new CustomEvent(MANUAL_MODEL_REFRESH_EVENT, { detail: false }));
    }
  };

  validateBinding = async (row: NewApiBindingImportRow): Promise<NewApiAccountSummary> => {
    return lambdaClient.aihub.validateBinding.mutate(row);
  };
}

export const aihubService = new AihubService();
export const newApiService = aihubService;
