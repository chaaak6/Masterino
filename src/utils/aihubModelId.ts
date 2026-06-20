export const normalizeAihubModelId = (modelId: string): string =>
  modelId
    .toLowerCase()
    .replaceAll(/(^|\/)glm(\d+)-\2(?=\.|$)/g, '$1glm-$2')
    .replaceAll(/(^|\/)glm(?=\d)/g, '$1glm-');

export const canonicalizeAihubModelId = (modelId: string): string =>
  modelId
    .replaceAll(/(^|\/)glm(\d+)-\2(?=\.|$)/gi, '$1glm-$2')
    .replaceAll(/(^|\/)glm(?=\d)/gi, '$1glm-')
    .replaceAll(/(^|\/)glm-/gi, '$1glm-');

export const canonicalizeAihubModelIdForProvider = (provider: string | undefined, modelId: string) =>
  provider === 'newapi' ? canonicalizeAihubModelId(modelId) : modelId;

export const isSameAihubModelId = (left: string, right: string): boolean =>
  normalizeAihubModelId(left) === normalizeAihubModelId(right);

export const includesAihubModelSearchText = (text: string, keyword: string): boolean => {
  const normalizedKeyword = normalizeAihubModelId(keyword.trim());
  const normalizedText = normalizeAihubModelId(text);

  return normalizedText.includes(normalizedKeyword);
};
