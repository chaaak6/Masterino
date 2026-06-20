// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAnalyticsConfig,
  fetchViteDevTemplate,
  getViteDevOrigin,
  renderSpaHtml,
} from './spaHtml';

describe('renderSpaHtml', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('injects server config, seo meta and strips the analytics placeholder', async () => {
    const template = [
      '<html><head>',
      '<!--SEO_META-->',
      '<script>window.__SERVER_CONFIG__ = undefined; /* SERVER_CONFIG */</script>',
      '</head><body><!--ANALYTICS_SCRIPTS--></body></html>',
    ].join('\n');

    const res = renderSpaHtml(template, {
      seoMeta: '<title>Hi</title>',
      serverConfig: { enableOIDC: true },
    });
    const html = await res.text();

    expect(html).toContain('window.__SERVER_CONFIG__ = {"enableOIDC":true};');
    expect(html).toContain('<title>Hi</title>');
    expect(html).not.toContain('SEO_META');
    expect(html).not.toContain('ANALYTICS_SCRIPTS');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('escapes script-breaking sequences in the server config', async () => {
    const template = 'window.__SERVER_CONFIG__ = undefined; /* SERVER_CONFIG */';
    const res = renderSpaHtml(template, {
      seoMeta: '',
      serverConfig: { html: '</script><script>alert(1)</script>' },
    });

    expect(await res.text()).not.toContain('</script>');
  });

  it('injects development service worker cleanup to prevent stale SPA caches', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const template = '<html><head></head><body></body></html>';
    const res = renderSpaHtml(template, {
      seoMeta: '',
      serverConfig: {},
    });

    expect(await res.text()).toContain('masterlion-dev-service-worker-cleanup');
  });
});

describe('getViteDevOrigin', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses VITE_DEV_ORIGIN when explicitly configured', () => {
    vi.stubEnv('VITE_DEV_ORIGIN', 'https://assets.example.com');

    const request = new Request('http://chat.example.com:3210/');

    expect(getViteDevOrigin(request)).toBe('https://assets.example.com');
  });

  it('uses the request host with the Vite port when dynamic origins are enabled', () => {
    vi.stubEnv('APP_URL_DYNAMIC', '1');
    vi.stubEnv('APP_URL_ALLOWED_HOSTS', '*');

    const request = new Request('http://internal:3210/', {
      headers: {
        'host': 'internal:3210',
        'x-forwarded-host': '43.156.160.39:3210',
        'x-forwarded-proto': 'http',
      },
    });

    expect(getViteDevOrigin(request)).toBe('http://43.156.160.39:9876');
  });

  it('uses the current request origin without the Vite port in same-origin public mode', async () => {
    vi.stubEnv('APP_URL_DYNAMIC', '1');
    vi.stubEnv('APP_URL_ALLOWED_HOSTS', '*');
    vi.stubEnv('VITE_DEV_PUBLIC_SAME_ORIGIN', '1');
    vi.resetModules();
    const { getViteDevOrigin } = await import('./spaHtml');

    const request = new Request('http://internal:3210/', {
      headers: {
        'host': 'internal:3210',
        'x-forwarded-host': '43.156.160.39:3210',
        'x-forwarded-proto': 'http',
      },
    });

    expect(getViteDevOrigin(request)).toBe('http://43.156.160.39:3210');
  });
});

describe('fetchViteDevTemplate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the Vite template from the internal origin and rewrites assets to the public origin', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        '<html><head><script type="module" src="/src/spa/entry.web.tsx"></script></head></html>',
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const html = await fetchViteDevTemplate(
      '/',
      'http://chat.example.com:9876',
      'http://localhost:9876',
    );

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:9876/');
    expect(html).toContain('src="http://chat.example.com:9876/src/spa/entry.web.tsx"');
  });
});

describe('buildAnalyticsConfig', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL;
  });

  it('includes desktop analytics only when opted in', () => {
    process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID = 'pid';
    process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL = 'https://umami.example.com';

    expect(buildAnalyticsConfig().desktop).toBeUndefined();
    expect(buildAnalyticsConfig({ desktop: true }).desktop).toEqual({
      baseUrl: 'https://umami.example.com',
      projectId: 'pid',
    });
  });
});
