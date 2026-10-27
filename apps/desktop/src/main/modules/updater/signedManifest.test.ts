import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  DESKTOP_RELEASE_BASE_URL,
  LEGACY_DESKTOP_RELEASE_BASE_URL,
  resolveArtifactUrl,
  selectUpdateArtifact,
  verifySignedManifest,
} from './signedManifest';

const baseUrl = 'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeySpkiB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const keyId = 'test-key';
const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const payload = {
  artifacts: [
    {
      arch: 'x64',
      path: 'canary/1.1.4/Masterino-1.1.4-setup.exe',
      platform: 'win32',
      sha512: 'hash',
      size: 100,
    },
    {
      arch: 'arm64',
      path: 'canary/1.1.4/Masterino-1.1.4-arm64.dmg',
      platform: 'darwin',
      sha512: 'hash',
      size: 100,
    },
    {
      arch: 'x64',
      path: 'canary/1.1.4/Masterino-1.1.4-x64.dmg',
      platform: 'darwin',
      sha512: 'hash',
      size: 100,
    },
  ],
  channel: 'canary',
  releaseDate: '2026-08-13T00:00:00.000Z',
  releaseNotes: 'Test update',
  version: '1.1.4',
};

const envelope = (value = payload) => {
  const bytes = Buffer.from(canonicalize(value));
  return {
    algorithm: 'Ed25519' as const,
    keyId,
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, privateKey).toString('base64'),
  };
};

const options = {
  baseUrl,
  channel: 'canary' as const,
  currentVersion: '1.1.3',
  keyId,
  publicKeySpkiB64,
};

describe('signed desktop update manifest', () => {
  it('maps both approved origins to the isolated local fixture', async () => {
    vi.resetModules();
    vi.stubEnv('DESKTOP_BUILD_FLAVOR', 'test');
    vi.stubEnv('DESKTOP_TEST_UPDATE_ORIGIN', 'http://127.0.0.1:19381');
    try {
      const { updateRequestUrl } = await import('./signedManifest');
      for (const base of [DESKTOP_RELEASE_BASE_URL, LEGACY_DESKTOP_RELEASE_BASE_URL]) {
        expect(updateRequestUrl(`${base}/canary/canary.json`)).toBe(
          'http://127.0.0.1:19381/desktop/releases/canary/canary.json',
        );
      }
      expect(() => updateRequestUrl('https://example.com/desktop/releases/file')).toThrow();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it.each([DESKTOP_RELEASE_BASE_URL, LEGACY_DESKTOP_RELEASE_BASE_URL])(
    'keeps signatures and all platform downloads valid through %s',
    (origin) => {
      const signed = envelope();
      const manifest = verifySignedManifest(signed, { ...options, baseUrl: origin });
      for (const artifact of manifest.artifacts) {
        expect(resolveArtifactUrl(origin, artifact.path).href).toBe(`${origin}/${artifact.path}`);
      }
      expect(() =>
        verifySignedManifest(
          { ...signed, signature: Buffer.alloc(64).toString('base64') },
          {
            ...options,
            baseUrl: origin,
          },
        ),
      ).toThrow('signature verification failed');
    },
  );

  it.each([
    'https://masterino-file.bielcrystal.com.evil.example/desktop/releases',
    'http://masterino-file.bielcrystal.com/desktop/releases',
    'https://masterino-file.bielcrystal.com:8443/desktop/releases',
    'https://user:password@masterino-file.bielcrystal.com/desktop/releases',
    'https://masterino-file.bielcrystal.com/other',
    'https://masterino-file.bielcrystal.com/desktop/releases?redirect=evil',
  ])('rejects modified release origins: %s', (origin) => {
    expect(() => resolveArtifactUrl(origin, 'canary/1.1.4/update.dmg')).toThrow();
  });

  it('verifies a signed OSS manifest', () => {
    expect(verifySignedManifest(envelope(), options).version).toBe('1.1.4');
  });

  it('rejects a modified payload', () => {
    const signed = envelope();
    signed.payload = Buffer.from(canonicalize({ ...payload, version: '9.9.9' })).toString('base64');
    expect(() => verifySignedManifest(signed, options)).toThrow('signature verification failed');
  });

  it('rejects a rollback', () => {
    expect(() => verifySignedManifest(envelope({ ...payload, version: '1.1.2' }), options)).toThrow(
      'version rollback',
    );
  });

  it('rejects a manifest for another channel', () => {
    expect(() =>
      verifySignedManifest(envelope({ ...payload, channel: 'stable' }), options),
    ).toThrow('channel mismatch');
  });

  it('rejects unapproved origins and traversal paths', () => {
    expect(() => resolveArtifactUrl('https://github.com/chaaak6/Masterino', 'file.exe')).toThrow(
      'approved release',
    );
    expect(() => resolveArtifactUrl(baseUrl, '../file.exe')).toThrow(
      'Invalid update artifact path',
    );
    expect(() => resolveArtifactUrl(baseUrl, 'canary/1.1.4/../1.1.5/file.exe')).toThrow(
      'Invalid update artifact path',
    );
    expect(() => resolveArtifactUrl(baseUrl, 'canary/1.1.4/%2e%2e/file.exe')).toThrow(
      'Invalid update artifact path',
    );
  });

  it('rejects a wrong public key', () => {
    const otherKey = generateKeyPairSync('ed25519')
      .publicKey.export({ format: 'der', type: 'spki' })
      .toString('base64');
    expect(() =>
      verifySignedManifest(envelope(), { ...options, publicKeySpkiB64: otherKey }),
    ).toThrow('signature verification failed');
  });

  it('selects the signed artifact for Windows and each macOS architecture', () => {
    const manifest = verifySignedManifest(envelope(), options);
    expect(selectUpdateArtifact(manifest, 'win32', 'x64')?.path).toContain('-setup.exe');
    expect(selectUpdateArtifact(manifest, 'darwin', 'arm64')?.path).toContain('-arm64.dmg');
    expect(selectUpdateArtifact(manifest, 'darwin', 'x64')?.path).toContain('-x64.dmg');
  });

  it('rejects a non-canonical signed payload', () => {
    const bytes = Buffer.from(
      JSON.stringify({
        version: payload.version,
        releaseNotes: payload.releaseNotes,
        releaseDate: payload.releaseDate,
        channel: payload.channel,
        artifacts: payload.artifacts,
      }),
    );
    expect(() =>
      verifySignedManifest(
        {
          algorithm: 'Ed25519',
          keyId,
          payload: bytes.toString('base64'),
          signature: sign(null, bytes, privateKey).toString('base64'),
        },
        options,
      ),
    ).toThrow('canonical JSON');
  });
});
