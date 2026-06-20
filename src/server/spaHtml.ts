import { analyticsEnv } from '@/envs/analytics';
import { getRequestOrigin } from '@/libs/url/requestOrigin';
import { serializeForHtml } from '@/server/utils/serializeForHtml';
import { type AnalyticsConfig } from '@/types/spaServerConfig';

export const VITE_DEV_ORIGIN = process.env.VITE_DEV_ORIGIN || 'http://localhost:9876';
const VITE_DEV_INTERNAL_ORIGIN = process.env.VITE_DEV_INTERNAL_ORIGIN || 'http://localhost:9876';
const VITE_DEV_PORT = process.env.VITE_DEV_PORT || '9876';
const VITE_DEV_PUBLIC_SAME_ORIGIN = process.env.VITE_DEV_PUBLIC_SAME_ORIGIN === '1';

const SERVER_CONFIG_PLACEHOLDER =
  /window\.__SERVER_CONFIG__\s*=\s*undefined;\s*\/\*\s*SERVER_CONFIG\s*\*\//;
const DEV_SERVICE_WORKER_CLEANUP_MARKER = 'masterlion-dev-service-worker-cleanup';
const DEV_SERVICE_WORKER_CLEANUP_SCRIPT = `<script id="${DEV_SERVICE_WORKER_CLEANUP_MARKER}">
(function(){
if(!('serviceWorker' in navigator))return;
var reloadKey='__masterlion_dev_sw_cleanup_reloaded__';
Promise.all([
  navigator.serviceWorker.getRegistrations().then(function(registrations){
    return Promise.all(registrations.map(function(registration){return registration.unregister()}));
  }),
  'caches' in window ? caches.keys().then(function(keys){
    return Promise.all(keys.map(function(key){return caches.delete(key)}));
  }) : Promise.resolve()
]).then(function(){
  if(navigator.serviceWorker.controller&&!sessionStorage.getItem(reloadKey)){
    sessionStorage.setItem(reloadKey,'1');
    location.reload();
  }
}).catch(function(){});
})();
</script>`;

async function rewriteViteAssetUrls(html: string, origin = VITE_DEV_ORIGIN): Promise<string> {
  const { parseHTML } = await import('linkedom');
  const { document } = parseHTML(html);

  document.querySelectorAll('script[src]').forEach((el: Element) => {
    const src = el.getAttribute('src');
    if (src && src.startsWith('/')) {
      el.setAttribute('src', `${origin}${src}`);
    }
  });

  document.querySelectorAll('link[href]').forEach((el: Element) => {
    const href = el.getAttribute('href');
    if (href && href.startsWith('/')) {
      el.setAttribute('href', `${origin}${href}`);
    }
  });

  document.querySelectorAll('script[type="module"]:not([src])').forEach((el: Element) => {
    const text = el.textContent || '';
    if (text.includes('/@')) {
      el.textContent = text.replaceAll(
        /from\s+["'](\/[@\w].*?)["']/g,
        (_match: string, p: string) => `from "${origin}${p}"`,
      );
    }
  });

  const workerPatch = document.createElement('script');
  workerPatch.textContent = `(function(){
var O=globalThis.Worker;
globalThis.Worker=function(u,o){
var h=typeof u==='string'?u:u instanceof URL?u.href:'';
if(h.startsWith('${origin}')){
var b=new Blob(['import "'+h+'";'],{type:'application/javascript'});
return new O(URL.createObjectURL(b),Object.assign({},o,{type:'module'}));
}return new O(u,o)};
globalThis.Worker.prototype=O.prototype;
})();`;
  const head = document.querySelector('head');
  if (head?.firstChild) {
    head.insertBefore(workerPatch, head.firstChild);
  }

  return document.toString();
}

export async function fetchViteDevTemplate(
  pathname = '/',
  origin = VITE_DEV_ORIGIN,
  fetchOrigin = VITE_DEV_INTERNAL_ORIGIN,
): Promise<string> {
  const res = await fetch(`${fetchOrigin}${pathname}`);
  const html = await res.text();

  return rewriteViteAssetUrls(html, origin);
}

export function getViteDevOrigin(request?: Request): string {
  if (process.env.VITE_DEV_ORIGIN) return process.env.VITE_DEV_ORIGIN;
  if (!request) return VITE_DEV_ORIGIN;

  if (VITE_DEV_PUBLIC_SAME_ORIGIN) {
    return getRequestOrigin(request, {
      fallbackUrl: VITE_DEV_ORIGIN,
    });
  }

  return getRequestOrigin(request, {
    fallbackUrl: VITE_DEV_ORIGIN,
    port: VITE_DEV_PORT,
  });
}

export function buildAnalyticsConfig(options: { desktop?: boolean } = {}): AnalyticsConfig {
  const config: AnalyticsConfig = {};

  if (analyticsEnv.ENABLE_GOOGLE_ANALYTICS && analyticsEnv.GOOGLE_ANALYTICS_MEASUREMENT_ID) {
    config.google = { measurementId: analyticsEnv.GOOGLE_ANALYTICS_MEASUREMENT_ID };
  }

  if (analyticsEnv.ENABLED_PLAUSIBLE_ANALYTICS && analyticsEnv.PLAUSIBLE_DOMAIN) {
    config.plausible = {
      domain: analyticsEnv.PLAUSIBLE_DOMAIN,
      scriptBaseUrl: analyticsEnv.PLAUSIBLE_SCRIPT_BASE_URL,
    };
  }

  if (analyticsEnv.ENABLED_UMAMI_ANALYTICS && analyticsEnv.UMAMI_WEBSITE_ID) {
    config.umami = {
      scriptUrl: analyticsEnv.UMAMI_SCRIPT_URL,
      websiteId: analyticsEnv.UMAMI_WEBSITE_ID,
    };
  }

  if (analyticsEnv.ENABLED_CLARITY_ANALYTICS && analyticsEnv.CLARITY_PROJECT_ID) {
    config.clarity = { projectId: analyticsEnv.CLARITY_PROJECT_ID };
  }

  if (analyticsEnv.ENABLED_POSTHOG_ANALYTICS && analyticsEnv.POSTHOG_KEY) {
    config.posthog = {
      debug: analyticsEnv.DEBUG_POSTHOG_ANALYTICS,
      host: analyticsEnv.POSTHOG_HOST,
      key: analyticsEnv.POSTHOG_KEY,
    };
  }

  if (analyticsEnv.ENABLED_X_ADS && analyticsEnv.X_ADS_PIXEL_ID) {
    config.xAds = {
      eventIds: {
        login_or_signup_clicked: analyticsEnv.X_ADS_LOGIN_OR_SIGNUP_CLICKED_EVENT_ID,
        main_page_view: analyticsEnv.X_ADS_MAIN_PAGE_VIEW_EVENT_ID,
      },
      pixelId: analyticsEnv.X_ADS_PIXEL_ID,
      purchaseEventId: analyticsEnv.X_ADS_PURCHASE_EVENT_ID,
    };
  }

  if (analyticsEnv.REACT_SCAN_MONITOR_API_KEY) {
    config.reactScan = { apiKey: analyticsEnv.REACT_SCAN_MONITOR_API_KEY };
  }

  if (analyticsEnv.ENABLE_VERCEL_ANALYTICS) {
    config.vercel = {
      debug: analyticsEnv.DEBUG_VERCEL_ANALYTICS,
      enabled: true,
    };
  }

  if (
    options.desktop &&
    process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID &&
    process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL
  ) {
    config.desktop = {
      baseUrl: process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL,
      projectId: process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID,
    };
  }

  return config;
}

export function renderSpaHtml(
  template: string,
  options: { seoMeta: string; serverConfig: unknown },
): Response {
  let html = template.replace(
    SERVER_CONFIG_PLACEHOLDER,
    `window.__SERVER_CONFIG__ = ${serializeForHtml(options.serverConfig)};`,
  );

  html = html.replace('<!--SEO_META-->', options.seoMeta);
  html = html.replace('<!--ANALYTICS_SCRIPTS-->', '');
  if (process.env.NODE_ENV === 'development' && !html.includes(DEV_SERVICE_WORKER_CLEANUP_MARKER)) {
    html = html.replace('</head>', `${DEV_SERVICE_WORKER_CLEANUP_SCRIPT}</head>`);
  }

  return new Response(html, {
    headers: {
      'Cache-Control': 'no-cache',
      'content-type': 'text/html; charset=utf-8',
    },
  });
}
