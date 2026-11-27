import { getAihubHiddenModelIds } from '@lobechat/business-const';
import type { ModelCatalogSettings } from '@lobechat/types';

export const getExcludedAihubModelIds = ({ availability }: ModelCatalogSettings) =>
  new Set([
    ...getAihubHiddenModelIds(),
    ...(availability ?? []).filter((entry) => entry.retired).map((entry) => entry.modelId),
  ]);

export const filterAihubModels = <T extends { id: string }>(
  models: T[],
  settings: ModelCatalogSettings,
): T[] => {
  const excluded = getExcludedAihubModelIds(settings);
  return models.filter((model) => !excluded.has(model.id));
};
