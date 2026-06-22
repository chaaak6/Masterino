import { type NextRequest, NextResponse } from 'next/server';

import { getWecomSsoRuntimeConfig } from '@/server/services/enterprise/wecomSsoService';

const WECOM_QR_AUTHORIZATION_URL = 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect';
const WECOM_WORKBENCH_AUTHORIZATION_URL = 'https://open.weixin.qq.com/connect/oauth2/authorize';
const WECOM_WEB_QR_MODE = 'web_qr';
const WECOM_WORKBENCH_MODE = 'workbench';

const SAFE_ERROR_MESSAGES = new Set([
  'WeCom SSO is not configured',
  'WeCom SSO is disabled',
  'WeCom Corp Secret is not configured',
  'WeCom web QR login is not enabled',
  'WeCom workbench login is not enabled',
]);

type WecomAuthorizeMode = typeof WECOM_WEB_QR_MODE | typeof WECOM_WORKBENCH_MODE;

const isWecomAuthorizeMode = (mode: string | null): mode is WecomAuthorizeMode =>
  mode === WECOM_WEB_QR_MODE || mode === WECOM_WORKBENCH_MODE;

const isEnterpriseWechatUserAgent = (userAgent: string | null) =>
  Boolean(userAgent?.toLowerCase().includes('wxwork'));

const resolveAuthorizeMode = (request: NextRequest, enabledModes: string[]): WecomAuthorizeMode => {
  const requestedMode = request.nextUrl.searchParams.get('mode');
  if (isWecomAuthorizeMode(requestedMode)) return requestedMode;

  if (
    enabledModes.includes(WECOM_WORKBENCH_MODE) &&
    isEnterpriseWechatUserAgent(request.headers.get('user-agent'))
  ) {
    return WECOM_WORKBENCH_MODE;
  }

  return WECOM_WEB_QR_MODE;
};

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
    const mode = resolveAuthorizeMode(request, runtimeConfig.enabledModes);
    const state = request.nextUrl.searchParams.get('state');
    const authorizeUrl =
      mode === WECOM_WORKBENCH_MODE
        ? new URL(WECOM_WORKBENCH_AUTHORIZATION_URL)
        : new URL(WECOM_QR_AUTHORIZATION_URL);

    if (!runtimeConfig.enabledModes.includes(mode)) {
      throw new Error(
        mode === WECOM_WORKBENCH_MODE
          ? 'WeCom workbench login is not enabled'
          : 'WeCom web QR login is not enabled',
      );
    }

    authorizeUrl.searchParams.set('appid', runtimeConfig.corpId);
    authorizeUrl.searchParams.set('agentid', runtimeConfig.agentId);
    authorizeUrl.searchParams.set('redirect_uri', runtimeConfig.redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set(
      'scope',
      mode === WECOM_WORKBENCH_MODE ? 'snsapi_privateinfo' : 'snsapi_login',
    );

    if (state) {
      authorizeUrl.searchParams.set('state', state);
    }

    if (mode === WECOM_WORKBENCH_MODE) {
      authorizeUrl.hash = 'wechat_redirect';
    }

    return NextResponse.redirect(authorizeUrl, 302);
  } catch (error) {
    return new Response(toSafeErrorMessage(error), { status: 400 });
  }
};
