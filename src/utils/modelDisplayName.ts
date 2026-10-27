/** Keep editorial alias markers out of the model picker without changing the model ID. */
export const modelDisplayName = (displayName: string | undefined, id: string): string =>
  (displayName || id).replace(/\s*[（(]兼容名[）)]\s*$/u, '').trim() || id;
