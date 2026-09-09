import { createPublicKey, verify } from 'node:crypto';

import semver from 'semver';
import { z } from 'zod';

import publicKeyConfig from './update-public-key.json';

const artifactSchema = z.object({
  arch: z.enum(['arm64', 'x64']),
  path: z.string().min(1),
  platform: z.enum(['darwin', 'win32']),
  sha512: z.string().min(1),
  size: z.number().int().positive(),
});

const payloadSchema = z.object({
  artifacts: z.array(artifactSchema).min(3),
  channel: z.enum(['canary', 'stable']),
  releaseDate: z.string().datetime(),
  releaseNotes: z.string().optional(),
  version: z.string().refine((value) => Boolean(semver.valid(value)), 'Invalid SemVer'),
});

const envelopeSchema = z.object({
  algorithm: z.literal('Ed25519'),
  keyId: z.string(),
  payload: z.string().min(1),
  signature: z.string().min(1),
});

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

const decodeCanonicalBase64 = (value: string, field: string) => {
  const normalized = value.replace(/=+$/, '');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== normalized) {
    throw new SignedManifestError(`Invalid ${field} encoding`, 'signature');
  }
  return bytes;
};

export type DesktopUpdateArtifact = z.infer<typeof artifactSchema>;
export type DesktopUpdateManifest = z.infer<typeof payloadSchema>;

export class SignedManifestError extends Error {
  constructor(
    message: string,
    public readonly code: 'integrity' | 'signature',
  ) {
    super(message);
    this.name = 'SignedManifestError';
  }
}

const normalizeBaseUrl = (rawUrl: string) => {
  const url = new URL(rawUrl.replace(/\/$/, ''));
  if (url.protocol !== 'https:')
    throw new SignedManifestError('Update server must use HTTPS', 'signature');
  if (
    url.hostname !== 'masterlion-prd.oss-cn-shenzhen.aliyuncs.com' ||
    url.pathname !== '/desktop/releases'
  ) {
    throw new SignedManifestError(
      'Update server is not the approved OSS release origin',
      'signature',
    );
  }
  return url;
};

export const resolveArtifactUrl = (baseUrl: string, artifactPath: string): URL => {
  const base = normalizeBaseUrl(baseUrl);
  if (
    artifactPath.startsWith('/') ||
    artifactPath.includes('\\') ||
    artifactPath.includes('%') ||
    artifactPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new SignedManifestError('Invalid update artifact path', 'signature');
  }

  const url = new URL(`${base.pathname.replace(/\/$/, '')}/${artifactPath}`, `${base.origin}/`);
  const expectedPrefix = `${base.pathname.replace(/\/$/, '')}/`;
  if (url.origin !== base.origin || !url.pathname.startsWith(expectedPrefix)) {
    throw new SignedManifestError('Update artifact is outside the OSS release prefix', 'signature');
  }
  return url;
};

export const verifySignedManifest = (
  input: unknown,
  options: {
    baseUrl: string;
    channel: 'canary' | 'stable';
    currentVersion: string;
    keyId?: string;
    publicKeySpkiB64?: string;
  },
): DesktopUpdateManifest => {
  const envelope = envelopeSchema.safeParse(input);
  if (!envelope.success)
    throw new SignedManifestError('Invalid signed update envelope', 'signature');
  const expectedKeyId = options.keyId ?? publicKeyConfig.keyId;
  if (envelope.data.keyId !== expectedKeyId) {
    throw new SignedManifestError('Unknown update signing key', 'signature');
  }

  const payloadBytes = decodeCanonicalBase64(envelope.data.payload, 'update payload');
  const signatureBytes = decodeCanonicalBase64(envelope.data.signature, 'update signature');
  let valid = false;
  try {
    const publicKey = createPublicKey({
      format: 'der',
      key: decodeCanonicalBase64(
        options.publicKeySpkiB64 ?? publicKeyConfig.publicKeySpkiB64,
        'update public key',
      ),
      type: 'spki',
    });
    valid = verify(null, payloadBytes, publicKey, signatureBytes);
  } catch (error) {
    if (error instanceof SignedManifestError) throw error;
    throw new SignedManifestError('Invalid update public key', 'signature');
  }
  if (!valid)
    throw new SignedManifestError('Update manifest signature verification failed', 'signature');

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw new SignedManifestError('Invalid update payload JSON', 'signature');
  }
  const payload = payloadSchema.safeParse(rawPayload);
  if (!payload.success) throw new SignedManifestError('Invalid update payload fields', 'signature');
  if (canonicalize(payload.data) !== payloadBytes.toString('utf8')) {
    throw new SignedManifestError('Update payload is not canonical JSON', 'signature');
  }
  if (payload.data.channel !== options.channel) {
    throw new SignedManifestError('Update channel mismatch', 'signature');
  }

  if (semver.lt(payload.data.version, options.currentVersion)) {
    throw new SignedManifestError('Update manifest attempts a version rollback', 'integrity');
  }

  for (const artifact of payload.data.artifacts) {
    const expectedPrefix = `${payload.data.channel}/${payload.data.version}/`;
    const expectedExtension = artifact.platform === 'win32' ? '.exe' : '.dmg';
    const fileName = artifact.path.slice(expectedPrefix.length);
    if (
      !artifact.path.startsWith(expectedPrefix) ||
      !/^[\w.+-]+$/.test(fileName) ||
      !fileName.endsWith(expectedExtension)
    ) {
      throw new SignedManifestError('Update artifact is not versioned', 'signature');
    }
    resolveArtifactUrl(options.baseUrl, artifact.path);
  }

  const artifactTargets = new Set(
    payload.data.artifacts.map(({ arch, platform }) => `${platform}/${arch}`),
  );
  if (
    payload.data.artifacts.length !== 3 ||
    new Set(payload.data.artifacts.map((artifact) => artifact.path)).size !== 3 ||
    !['win32/x64', 'darwin/arm64', 'darwin/x64'].every((target) => artifactTargets.has(target))
  ) {
    throw new SignedManifestError('Update manifest has unexpected artifact targets', 'signature');
  }

  return payload.data;
};

export const selectUpdateArtifact = (
  manifest: DesktopUpdateManifest,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): DesktopUpdateArtifact | undefined =>
  manifest.artifacts.find((artifact) => artifact.platform === platform && artifact.arch === arch);
