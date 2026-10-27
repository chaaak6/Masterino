import { useMemo } from 'react';

import { type EnabledProviderWithModels } from '@/types/aiProvider';
import { modelDisplayName } from '@/utils/modelDisplayName';

export const useCurrentModelName = (
  enabledList: EnabledProviderWithModels[],
  model: string,
): string => {
  return useMemo(() => {
    for (const providerItem of enabledList) {
      const modelItem = providerItem.children.find((m) => m.id === model);
      if (modelItem) {
        return modelDisplayName(modelItem.displayName, modelItem.id);
      }
    }
    return model;
  }, [enabledList, model]);
};
