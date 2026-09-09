/** Copy trace data without persisting inline image bytes. Never alter the model request. */
export function sanitizeTraceData<T>(value: T): T {
  if (typeof value === 'string')
    return value.replaceAll(
      /data:image\/[\w.+-]+(?:;[\w=.+-]+)*;base64,[\w+/=-]+/gi,
      '[inline image omitted]',
    ) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeTraceData(item)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        // Anthropic represents the same image as a separate MIME type and base64 field.
        key === 'data' &&
        record.type === 'base64' &&
        typeof record.media_type === 'string' &&
        record.media_type.startsWith('image/')
          ? '[inline image omitted]'
          : sanitizeTraceData(item),
      ]),
    ) as T;
  }
  return value;
}
