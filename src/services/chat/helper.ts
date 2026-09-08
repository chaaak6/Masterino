import { ModelProvider } from 'model-bank';

import { resolveChatModelCatalog } from '@/helpers/modelCatalog';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';

const getModel = (model: string, provider: string) => {
  const state = getAiInfraStoreState();
  const exactModel = state.enabledAiModels?.find(
    (item) => item.id === model && item.providerId === provider,
  );

  if (exactModel || provider !== ModelProvider.LobeHub) return exactModel;

  return state.enabledAiModels?.find((item) => item.id === model);
};

export const isCanUseVision = (model: string, provider: string): boolean => {
  const item = getModel(model, provider);
  return item ? resolveChatModelCatalog(item).entry.inputModalities.image === 'supported' : false;
};

export const isCanUseVideo = (model: string, provider: string): boolean => {
  return getModel(model, provider)?.abilities?.video || false;
};

/**
 * TODO: we need to update this function to auto find deploymentName with provider setting config
 */
export const findDeploymentName = (model: string, provider: string) => {
  let deploymentId = model;

  // find the model by id
  const modelItem = getAiInfraStoreState().enabledAiModels?.find(
    (i) => i.id === model && i.providerId === provider,
  );

  if (modelItem && modelItem.config?.deploymentName) {
    deploymentId = modelItem.config?.deploymentName;
  }

  return deploymentId;
};

export const isEnableFetchOnClient = (provider: string) => {
  return aiProviderSelectors.isProviderFetchOnClient(provider)(getAiInfraStoreState());
};

export const resolveRuntimeProvider = (provider: string) => {
  const isBuiltin = Object.values(ModelProvider).includes(provider as any);
  if (isBuiltin) return provider;

  const providerConfig = aiProviderSelectors.providerConfigById(provider)(getAiInfraStoreState());

  return providerConfig?.settings.sdkType || 'openai';
};
