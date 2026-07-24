import { BRANDING_NAME } from '@lobechat/business-const';
import { OG_URL } from '@lobechat/const';
import { serverDB } from '@lobechat/database';

import { getServerFeatureFlagsValue } from '@/config/featureFlags';
import { OFFICIAL_URL } from '@/const/url';
import { isDesktop } from '@/const/version';
import { WorkspaceModel } from '@/database/models/workspace';
import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';
import { pythonEnv } from '@/envs/python';
import { type Locales } from '@/locales/resources';
import { getServerGlobalConfig } from '@/server/globalConfig';
import {
  buildAnalyticsConfig,
  fetchViteDevTemplate,
  getViteDevOrigin,
  renderSpaHtml,
} from '@/server/spaHtml';
import { translation } from '@/server/translation';
import { type SPAClientEnv, type SPAServerConfig } from '@/types/spaServerConfig';
import { RouteVariants } from '@/utils/server/routeVariants';

import { classifySpaPath } from './pathPolicy';

export function generateStaticParams() {
  const mobileOptions = isDesktop ? [false] : [true, false];
  const staticLocales: Locales[] = ['en-US', 'zh-CN'];

  const variants: { variants: string }[] = [];

  for (const locale of staticLocales) {
    for (const isMobile of mobileOptions) {
      variants.push({
        variants: RouteVariants.serializeVariants({ isMobile, locale }),
      });
    }
  }

  return variants;
}

const isDev = process.env.NODE_ENV === 'development';

async function getTemplate(isMobile: boolean, request: Request): Promise<string> {
  if (isDev) {
    return fetchViteDevTemplate(isMobile ? '/index.mobile.html' : '/', getViteDevOrigin(request));
  }

  const { desktopHtmlTemplate, mobileHtmlTemplate } = await import('./spaHtmlTemplates');

  return isMobile ? mobileHtmlTemplate : desktopHtmlTemplate;
}

function buildClientEnv(): SPAClientEnv {
  return {
    marketBaseUrl: appEnv.MARKET_BASE_URL,
    pyodideIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_INDEX_URL,
    pyodidePipIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_PIP_INDEX_URL,
    s3FilePath: fileEnv.NEXT_PUBLIC_S3_FILE_PATH,
  };
}

async function buildSeoMeta(locale: string): Promise<string> {
  const { t } = await translation('metadata', locale);
  const title = t('chat.title', { appName: BRANDING_NAME });
  const description = t('chat.description', { appName: BRANDING_NAME });

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${OFFICIAL_URL}" />`,
    `<meta property="og:image" content="${OG_URL}" />`,
    `<meta property="og:site_name" content="${BRANDING_NAME}" />`,
    `<meta property="og:locale" content="${locale}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${OG_URL}" />`,
    `<meta name="twitter:site" content="@Masterino" />`,
  ].join('\n    ');
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[]; variants: string }> },
) {
  const { path, variants } = await params;
  const pathClassification = classifySpaPath(path);

  if (pathClassification === 'unknown') {
    return new Response('Not Found', {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      status: 404,
    });
  }

  if (pathClassification === 'workspace') {
    try {
      const workspace = await new WorkspaceModel(serverDB, '').findBySlug(path![0]);
      if (!workspace) {
        return new Response('Not Found', {
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
          },
          status: 404,
        });
      }
    } catch {
      return new Response('Not Found', {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        },
        status: 404,
      });
    }
  }

  const { locale, isMobile } = RouteVariants.deserializeVariants(variants);

  const spaConfig: SPAServerConfig = {
    analyticsConfig: buildAnalyticsConfig({ desktop: true }),
    clientEnv: buildClientEnv(),
    config: await getServerGlobalConfig(),
    featureFlags: getServerFeatureFlagsValue(),
    isMobile,
  };

  const template = await getTemplate(isMobile, request);
  const seoMeta = await buildSeoMeta(locale);

  return renderSpaHtml(template, { seoMeta, serverConfig: spaConfig });
}
