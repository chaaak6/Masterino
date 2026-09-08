import {
  resolveArtifactUrl,
  verifySignedManifest,
} from '../../../../../../apps/desktop/src/main/modules/updater/signedManifest';

export const runtime = 'nodejs';

const baseUrl = 'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases';

// Reuse the Electron updater's pure verifier; no Electron runtime is loaded.
export async function GET() {
  try {
    const response = await fetch(`${baseUrl}/canary/canary.json`, {
      next: { revalidate: 60 },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Release manifest unavailable');
    const manifest = verifySignedManifest(await response.json(), {
      baseUrl,
      channel: 'canary',
      currentVersion: '0.0.0',
    });
    return Response.json(
      {
        artifacts: manifest.artifacts.map(({ arch, path, platform }) => ({
          arch,
          platform,
          url: resolveArtifactUrl(baseUrl, path).href,
        })),
        version: manifest.version,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'DOWNLOAD_UNAVAILABLE' },
      {
        headers: { 'Cache-Control': 'no-store' },
        status: 503,
      },
    );
  }
}
