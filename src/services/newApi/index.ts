import type {
  NewApiAccountSummary,
  NewApiBindingImportResult,
  NewApiBindingImportRow,
  NewApiBindingStatus,
  NewApiUsageSummary,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AihubService {
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

  importBindings = async (
    rows: NewApiBindingImportRow[],
  ): Promise<NewApiBindingImportResult[]> => {
    return lambdaClient.aihub.importBindings.mutate({ rows });
  };

  syncModels = async () => {
    return lambdaClient.aihub.syncModels.mutate();
  };

  validateBinding = async (row: NewApiBindingImportRow): Promise<NewApiAccountSummary> => {
    return lambdaClient.aihub.validateBinding.mutate(row);
  };
}

export const aihubService = new AihubService();
export const newApiService = aihubService;
