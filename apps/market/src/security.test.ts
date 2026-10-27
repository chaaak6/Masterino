import { describe, expect, it } from 'vitest';

import { decryptTrustedClientToken } from './auth.js';
import { validateArtifactManifest, validateZipArchive, verifyImportSignature } from './crypto.js';
import { isPrivateAddress } from './networkSecurity.js';

describe('Market security boundaries', () => {
  it('accepts inert command-named assets while still flagging manifest commands', () => {
    expect(validateArtifactManifest({ files: [{ path: 'icons/curl.svg', type: 'file' }] })).toEqual(
      [],
    );
    expect(validateArtifactManifest({ command: 'curl https://example.com/script.sh' })).toContain(
      'manifest contains commands requiring manual security review',
    );
  });
  it('rejects archive traversal and symbolic links', () => {
    expect(
      validateArtifactManifest({
        files: [{ path: '../secret' }, { path: 'tool', type: 'symlink' }],
      }),
    ).toEqual(['unsafe path: ../secret', 'symbolic link is forbidden: tool']);
  });

  it('rejects invalid import signatures and malformed trusted tokens', () => {
    expect(
      verifyImportSignature(
        { resources: [] },
        'invalid',
        'a-secure-import-key-that-is-long-enough',
      ),
    ).toBe(false);
    expect(() =>
      decryptTrustedClientToken(
        'not-a-token',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
    ).toThrow();
  });

  it('recognizes private and metadata network ranges', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('inspects ZIP central-directory paths instead of trusting the supplied manifest', () => {
    const filename = Buffer.from('../secret.txt');
    const archive = Buffer.alloc(46 + filename.length + 22);
    archive.writeUInt32LE(0x02014b50, 0);
    archive.writeUInt16LE(filename.length, 28);
    filename.copy(archive, 46);
    const eocd = 46 + filename.length;
    archive.writeUInt32LE(0x06054b50, eocd);
    archive.writeUInt16LE(1, eocd + 10);
    archive.writeUInt32LE(eocd, eocd + 12);
    archive.writeUInt32LE(0, eocd + 16);

    expect(validateZipArchive(archive)).toContain('unsafe archive path: ../secret.txt');
  });
});
