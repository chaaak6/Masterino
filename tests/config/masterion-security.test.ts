// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';

const productionOverlay = path.join(process.cwd(), 'k8s', 'overlays', 'production');

const readYaml = async (fileName: string) =>
  parse(await readFile(path.join(productionOverlay, fileName), 'utf8'));

describe('Masterion production security configuration', () => {
  it('keeps public email registration disabled and enables browser protections', async () => {
    const configMap = await readYaml('configmap.yaml');

    expect(configMap.data).toMatchObject({
      AUTH_DISABLE_EMAIL_SIGNUP: '1',
      ENABLED_CSP: '1',
      MODEL_PROVIDER_ALLOWED_ORIGINS: 'https://aihub.bielcrystal.com',
      OPENAPI_CORS_ALLOWED_ORIGINS: 'https://aihub.bielcrystal.com',
      SKILL_IMPORT_ALLOWED_ORIGINS:
        'https://masterion.bielcrystal.com,https://github.com,https://raw.githubusercontent.com,https://codeload.github.com,https://pinchwork.dev',
    });
  });

  it('removes internal Next.js routing and framework headers at the Node response boundary', async () => {
    const ingress = await readYaml('ingress.yaml');
    const dockerfile = await readFile(path.join(process.cwd(), 'Dockerfile'), 'utf8');
    const hardeningScript = await readFile(
      path.join(process.cwd(), 'scripts', '_shared', 'hardenResponseHeaders.js'),
      'utf8',
    );

    expect(ingress.metadata.annotations).not.toHaveProperty(
      'nginx.ingress.kubernetes.io/configuration-snippet',
    );
    expect(dockerfile).toContain(
      'NODE_OPTIONS="--require=/app/scripts/_shared/hardenResponseHeaders.js',
    );

    for (const header of [
      'X-Middleware-Rewrite',
      'X-Middleware-Set-Cookie',
      'X-Nextjs-Cache',
      'X-Nextjs-Matched-Path',
      'X-Nextjs-Prerender',
      'X-Nextjs-Rewritten-Path',
      'X-Nextjs-Rewritten-Query',
      'X-Nextjs-Stale-Time',
      'X-Invoke-Path',
      'X-Invoke-Query',
      'X-Invoke-Output',
      'X-Powered-By',
    ]) {
      expect(hardeningScript).toContain(`'${header}'`);
    }
  });

  it('rate limits the public OIDC token protocol endpoint', async () => {
    const ingress = await readYaml('oidc-token-ingress.yaml');

    expect(ingress.metadata.annotations).toMatchObject({
      'nginx.ingress.kubernetes.io/limit-burst-multiplier': '1',
      'nginx.ingress.kubernetes.io/limit-rpm': '5',
      'nginx.ingress.kubernetes.io/proxy-body-size': '16k',
    });
    expect(ingress.spec.rules[0].http.paths[0]).toMatchObject({
      path: '/oidc/token',
      pathType: 'Exact',
    });
  });

  it('rate limits and caps authenticated trace ingestion', async () => {
    const ingress = await readYaml('webapi-trace-ingress.yaml');

    expect(ingress.metadata.annotations).toMatchObject({
      'nginx.ingress.kubernetes.io/limit-burst-multiplier': '1',
      'nginx.ingress.kubernetes.io/limit-rpm': '60',
      'nginx.ingress.kubernetes.io/proxy-body-size': '32k',
    });
    expect(ingress.spec.rules[0].http.paths[0]).toMatchObject({
      path: '/webapi/trace',
      pathType: 'Exact',
    });
  });

  it('denies pod egress to cloud metadata services', async () => {
    const policy = await readYaml('metadata-egress-network-policy.yaml');
    const externalEgress = policy.spec.egress.find(
      (rule: { to?: { ipBlock?: { cidr?: string } }[] }) =>
        rule.to?.[0]?.ipBlock?.cidr === '0.0.0.0/0',
    );

    expect(externalEgress.to[0].ipBlock.except).toEqual(
      expect.arrayContaining(['100.100.100.200/32', '169.254.169.254/32']),
    );
  });

  it('does not mount Kubernetes credentials and drops container privileges', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'k8s', 'base', 'masterino.yaml'),
      'utf8',
    );
    const documents = parseAllDocuments(source).map((document) => document.toJS());
    const deployment = documents.find(
      (document: { kind?: string; metadata?: { name?: string } }) =>
        document.kind === 'Deployment' && document.metadata?.name === 'masterino',
    );
    const podSpec = deployment.spec.template.spec;
    const container = podSpec.containers.find(
      (item: { name?: string }) => item.name === 'masterino',
    );

    expect(podSpec.automountServiceAccountToken).toBe(false);
    expect(podSpec.securityContext.seccompProfile.type).toBe('RuntimeDefault');
    expect(container.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
    });
  });

  it('does not publish browser source maps in the SPA production build', async () => {
    const viteConfig = await readFile(path.join(process.cwd(), 'vite.config.ts'), 'utf8');

    expect(viteConfig).toContain('sourcemap: false');
  });
});
