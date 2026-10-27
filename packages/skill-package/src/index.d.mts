export const SKILL_SOURCE_MAX_BYTES: number;
export const SKILL_PACKAGE_MAX_BYTES: number;
export const SKILL_MAX_ENTRIES: number;
export const SKILL_EXPANDED_MAX_BYTES: number;
export const SKILL_FILE_MAX_BYTES: number;
export function readBoundedSkillBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>>;
