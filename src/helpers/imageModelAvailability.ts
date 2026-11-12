import { ModelParamsMetaSchema } from 'model-bank';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

/** Image classification alone does not establish a usable generation configuration. */
export const isImageModelAvailable = (
  enabledList: EnabledProviderWithModels[],
  modelId: string,
  providerId: string,
): boolean => {
  const model = enabledList
    .find((provider) => provider.id === providerId)
    ?.children.find((model) => model.id === modelId);
  return ModelParamsMetaSchema.safeParse(model?.parameters).success;
};
