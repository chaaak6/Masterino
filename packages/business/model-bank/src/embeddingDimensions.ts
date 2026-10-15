import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import { classifyModelKindById } from './modelCatalog';

/** Unknown models remain selectable; known insufficient dimensions are rejected. */
export const supportsEmbeddingDimension = (modelId: string, requiredDimension: number) => {
  // Some provider catalogs label rerank endpoints as embeddings. They cannot
  // produce vectors even when no dimension metadata is available.
  if (classifyModelKindById(modelId).kind === 'rerank') return false;

  const knownModels = LOBE_DEFAULT_MODEL_LIST.filter(
    (item) => item.type === 'embedding' && item.id.toLowerCase() === modelId.toLowerCase(),
  );
  if (knownModels.length === 0) return true;

  const knownDimensions = knownModels
    .map((model) => model.maxDimension)
    .filter((dimension): dimension is number => typeof dimension === 'number');
  if (knownDimensions.length === 0) return true;

  return knownDimensions.some((dimension) => dimension >= requiredDimension);
};
