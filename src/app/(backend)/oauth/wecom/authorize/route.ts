import { type NextRequest, NextResponse } from 'next/server';

import { getWecomSsoRuntimeConfig } from '@/server/services/enterprise/wecomSsoService';

const WECOM_AUTHORIZATION_URL = 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect';
const WECOM_WEB_QR_MODE = 'web_qr';

const SAFE_ERROR_MESSAGES = new Set([
  'WeCom SSO is not configured',
  'WeCom SSO is disabled',
  'WeCom Corp Secret is not configured',
  'WeCom web QR login is not enabled',
]);

const toSafeErrorMessage = (error: unknown) => {
  if (error instanceof Error && SAFE_ERROR_MESSAGES.has(error.message)) {
    return error.message;
  }

  console.error('[WeCom SSO] Authorization failed', error);

  return 'WeCom SSO authorization failed';
};

export const GET = async (request: NextRequest) => {
  try {
    const runtimeConfig = await getWecomSsoRuntimeConfig();
    if (!runtimeConfig.enabledModes.includes(WECOM_WEB_QR_MODE)) {
      throw new Error('WeCom web QR login is not enabled');
    }

    const state = request.nextUrl.searchParams.get('state');
    const authorizeUrl = new URL(WECOM_AUTHORIZATION_URL);

    authorizeUrl.searchParams.set('appid', runtimeConfig.corpId);
    authorizeUrl.searchParams.set('agentid', runtimeConfig.agentId);
    authorizeUrl.searchParams.set('redirect_uri', runtimeConfig.redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'snsapi_login');

    if (state) {
      authorizeUrl.searchParams.set('state', state);
    }

    return NextResponse.redirect(authorizeUrl, 302);
  } catch (error) {
    return new Response(toSafeErrorMessage(error), { status: 400 });
  }
};
