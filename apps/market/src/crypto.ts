import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { SKILL_MAX_ENTRIES } from '@lobechat/skill-package';

const keyFromSecret = (secret: string) => createHash('sha256').update(secret).digest();

export const encryptJson = (value: unknown, secret: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
};

export const decryptJson = <T>(value: string, secret: string): T => {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'),
  ) as T;
};

export const sha256 = (value: Buffer | string): string =>
  createHash('sha256').update(value).digest('hex');

export const verifyImportSignature = (
  payload: unknown,
  signature: string,
  key: string,
): boolean => {
  const expected = createHmac('sha256', key).update(JSON.stringify(payload)).digest();
  if (!/^[A-Z\d+/]+={0,2}$/i.test(signature) || signature.length % 4 !== 0) return false;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  return (
    supplied.toString('base64') === signature &&
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
  );
};

const forbiddenArchivePath = /(?:^|\/)\.\.?(?:\/|$)|^[a-z]:|^\//i;
export const validateArtifactManifest = (manifest: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const file of files) {
    if (!file || typeof file !== 'object') {
      errors.push('manifest contains invalid file entry');
      continue;
    }
    const path = String((file as { path?: unknown }).path || '').replaceAll('\\', '/');
    if (!path || forbiddenArchivePath.test(path)) errors.push(`unsafe path: ${path || '<empty>'}`);
    if ((file as { type?: unknown }).type === 'symlink')
      errors.push(`symbolic link is forbidden: ${path}`);
  }
  // File names are inert resources; command checks apply to executable manifest settings.
  const { files: _files, ...settings } = manifest;
  const commands = JSON.stringify(settings).match(
    /curl|wget|powershell|cmd\.exe|bash\s+-c|sh\s+-c/gi,
  );
  if (commands) errors.push('manifest contains commands requiring manual security review');
  return errors;
};

export const validateZipArchive = (archive: Buffer): string[] => {
  const errors: string[] = [];
  const minimumEocdSize = 22;
  let eocd = -1;
  for (
    let offset = archive.length - minimumEocdSize;
    offset >= Math.max(0, archive.length - 65_557);
    offset--
  ) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return ['artifact is not a valid ZIP archive'];
  const entryCount = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);
  if (entryCount > SKILL_MAX_ENTRIES) errors.push('archive contains too many files');
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount && errors.length < 50; index++) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) {
      errors.push('archive central directory is malformed');
      break;
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const filenameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const end = cursor + 46 + filenameLength + extraLength + commentLength;
    if (end > archive.length) {
      errors.push('archive entry exceeds file boundary');
      break;
    }
    const path = archive
      .subarray(cursor + 46, cursor + 46 + filenameLength)
      .toString('utf8')
      .replaceAll('\\', '/');
    if (!path || forbiddenArchivePath.test(path))
      errors.push(`unsafe archive path: ${path || '<empty>'}`);
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) errors.push(`symbolic link is forbidden: ${path}`);
    if (flags & 1) errors.push(`encrypted archive entry is forbidden: ${path}`);
    if (/\.(?:exe|dll|scr|com|msi|docm|xlsm)$/i.test(path))
      errors.push(`executable or macro-enabled file is forbidden: ${path}`);
    if (uncompressedSize > 25 * 1024 * 1024) errors.push(`archive entry is too large: ${path}`);
    if (compressedSize > 0 && uncompressedSize / compressedSize > 200)
      errors.push(`suspicious compression ratio: ${path}`);
    totalUncompressed += uncompressedSize;
    cursor = end;
  }
  if (totalUncompressed > 100 * 1024 * 1024)
    errors.push('archive expands beyond the 100 MiB safety limit');
  return errors;
};
