import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.split('=')));
const releaseDir = path.resolve(args['--release-dir'] || 'release');
const channel = args['--channel'];
const version = args['--version'];
const privateKeyB64 = process.env.DESKTOP_UPDATE_SIGNING_PRIVATE_KEY_B64;
const keyId = 'masterino-desktop-2026-01';

const canonicalize = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

if (!channel || !version || !privateKeyB64) {
  throw new Error('Signed desktop manifest requires channel, version and signing private key');
}
if (!/^(?:canary|stable)$/.test(channel) || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('Invalid desktop update channel or version');
}

const resolveArtifactFile = (candidates) => {
  const matches = candidates.filter((file) => fs.existsSync(path.join(releaseDir, file)));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one release artifact from ${candidates.join(', ')}, found ${matches.length}`,
    );
  }
  return matches[0];
};

const artifactSpecs = [
  { arch: 'x64', file: `Masterino-${version}-setup.exe`, platform: 'win32' },
  {
    arch: 'arm64',
    file: resolveArtifactFile([
      `Masterino-${version}-unsigned-arm64.dmg`,
      `Masterino-${version}-arm64.dmg`,
    ]),
    platform: 'darwin',
  },
  {
    arch: 'x64',
    file: resolveArtifactFile([
      `Masterino-${version}-unsigned-x64.dmg`,
      `Masterino-${version}-x64.dmg`,
    ]),
    platform: 'darwin',
  },
];

const artifacts = artifactSpecs.map(({ arch, file, platform }) => {
  const filePath = path.join(releaseDir, file);
  const content = fs.readFileSync(filePath);
  return {
    arch,
    path: `${channel}/${version}/${file}`,
    platform,
    sha512: createHash('sha512').update(content).digest('base64'),
    size: content.byteLength,
  };
});

const payload = Buffer.from(
  canonicalize({
    artifacts,
    channel,
    releaseDate: new Date().toISOString(),
    ...(process.env.RELEASE_NOTES ? { releaseNotes: process.env.RELEASE_NOTES } : {}),
    version,
  }),
  'utf8',
);
const privateKey = createPrivateKey({
  format: 'der',
  key: Buffer.from(privateKeyB64, 'base64'),
  type: 'pkcs8',
});
if (privateKey.asymmetricKeyType !== 'ed25519')
  throw new Error('Update signing key must be Ed25519');
const signature = sign(null, payload, privateKey);
const publicKey = createPublicKey(privateKey);
if (!verify(null, payload, publicKey, signature))
  throw new Error('Unable to self-verify signed update manifest');
const committedKey = JSON.parse(
  fs.readFileSync('packages/desktop-release/src/update-public-key.json', 'utf8'),
);
const derivedPublicKeyB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
if (committedKey.keyId !== keyId || committedKey.publicKeySpkiB64 !== derivedPublicKeyB64) {
  throw new Error(
    'Update signing private key does not match the public key embedded in the client',
  );
}

const envelope = {
  algorithm: 'Ed25519',
  keyId,
  payload: payload.toString('base64'),
  signature: signature.toString('base64'),
};
fs.writeFileSync(
  path.join(releaseDir, `${channel}.json`),
  `${JSON.stringify(envelope, null, 2)}\n`,
);
console.info(`Created signed ${channel}.json for Masterino ${version}`);
