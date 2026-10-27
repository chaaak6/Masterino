import {
  DESKTOP_RELEASE_BASE_URL,
  LEGACY_DESKTOP_RELEASE_BASE_URL,
  resolveArtifactUrl as resolve,
  verifySignedManifest as verify,
} from '@lobechat/desktop-release';

export * from '@lobechat/desktop-release';

// Compiled only into isolated test builds. Production cannot change its release origin/key at runtime.
const testOrigin =
  process.env.DESKTOP_BUILD_FLAVOR === 'test' ? process.env.DESKTOP_TEST_UPDATE_ORIGIN : undefined;
const releaseOrigins = new Set(
  [DESKTOP_RELEASE_BASE_URL, LEGACY_DESKTOP_RELEASE_BASE_URL].map((base) => new URL(base).origin),
);
export function updateRequestUrl(value: string) {
  if (!testOrigin) return value;
  const target = new URL(testOrigin);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:')
    throw new Error('Test updates require the local fixture server');
  const url = new URL(value);
  if (!releaseOrigins.has(url.origin) || !url.pathname.startsWith('/desktop/releases/'))
    throw new Error('Invalid test update path');
  return new URL(url.pathname, target).toString();
}
export const resolveArtifactUrl: typeof resolve = (base, artifact) =>
  new URL(updateRequestUrl(resolve(base, artifact).toString()));
export const verifySignedManifest: typeof verify = (input, options) =>
  verify(
    input,
    testOrigin
      ? {
          ...options,
          keyId: process.env.DESKTOP_TEST_UPDATE_KEY_ID,
          publicKeySpkiB64: process.env.DESKTOP_TEST_UPDATE_PUBLIC_KEY,
        }
      : options,
  );
