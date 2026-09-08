/** Checked at fetch, after the SDK/provider has serialized images and JSON. */
export const MAX_MODEL_REQUEST_BYTES = 20 * 1024 * 1024;

export function withRequestBodyBudget(
  fetcher: typeof fetch = globalThis.fetch,
  limit = MAX_MODEL_REQUEST_BYTES,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    if (request.body) {
      const reader = request.clone().body!.getReader();
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limit) {
            void reader.cancel();
            throw new Error(
              `Model request exceeds ${limit} bytes; reduce selected images or context.`,
            );
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    return fetcher(input, init);
  };
}
