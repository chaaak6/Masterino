/** Shared publisher/consumer contract. Source archives are normalized before publication. */
export const SKILL_SOURCE_MAX_BYTES = 64 * 1024 * 1024;
export const SKILL_PACKAGE_MAX_BYTES = 32 * 1024 * 1024;
export const SKILL_MAX_ENTRIES = 20_000;
export const SKILL_EXPANDED_MAX_BYTES = 100 * 1024 * 1024;
export const SKILL_FILE_MAX_BYTES = 25 * 1024 * 1024;

export class SkillBodyTooLargeError extends Error {}

/** Bound memory even when Content-Length is absent or untrusted. */
/** @param {ReadableStream<Uint8Array> | null} body @param {number} maxBytes */
export async function readBoundedSkillBody(body, maxBytes) {
  if (!body) throw new Error('Skill package body is empty');
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new SkillBodyTooLargeError(
          `Skill package exceeds the ${maxBytes / 1024 / 1024} MiB limit`,
        );
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
