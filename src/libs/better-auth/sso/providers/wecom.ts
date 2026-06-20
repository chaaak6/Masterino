import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { getWecomSsoRuntimeConfig } from '@/server/services/enterprise/wecomSsoService';

import { type GenericProviderDefinition } from '../types';

const WECOM_TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken';
const WECOM_USERINFO_URL = 'https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo';
const WECOM_USER_DETAIL_URL = 'https://qyapi.weixin.qq.com/cgi-bin/user/get';

type WecomAccessTokenResponse = {
  access_token?: string;
  errcode?: number;
  errmsg?: string;
  expires_in?: number;
};

type WecomAuthUserResponse = {
  DeviceId?: string;
  OpenId?: string;
  UserId?: string;
  errcode?: number;
  errmsg?: string;
  expires_in?: number;
  user_ticket?: string;
};

type WecomUserDetailResponse = {
  alias?: string;
  avatar?: string;
  email?: string;
  errcode?: number;
  errmsg?: string;
  mobile?: string;
  name?: string;
  position?: string;
  userid?: string;
};

type WecomTokenRaw = {
  authUser: WecomAuthUserResponse;
  token: WecomAccessTokenResponse;
};

const hasWecomError = (data: { errcode?: number }) =>
  typeof data.errcode === 'number' && data.errcode !== 0;

const assertWecomSuccess = (data: { errcode?: number; errmsg?: string }, fallback: string) => {
  if (hasWecomError(data)) {
    throw new Error(data.errmsg ?? fallback);
  }
};

const provider: GenericProviderDefinition<{
  AUTH_WECOM_AGENT_ID: string;
  AUTH_WECOM_CORP_ID: string;
  AUTH_WECOM_CORP_SECRET: string;
}> = {
  aliases: ['enterprise-wechat', 'wework'],
  build: (env) => {
    const clientId = env.AUTH_WECOM_CORP_ID || 'wecom';
    const clientSecret = env.AUTH_WECOM_CORP_SECRET || 'wecom';

    return {
      authorizationUrl: `${appEnv.APP_URL}/oauth/wecom/authorize`,
      authorizationUrlParams: {
        scope: 'snsapi_login',
      },
      clientId,
      clientSecret,
      getToken: async ({ code }) => {
        const runtimeConfig = await getWecomSsoRuntimeConfig();
        const tokenUrl = new URL(WECOM_TOKEN_URL);
        tokenUrl.searchParams.set('corpid', runtimeConfig.corpId);
        tokenUrl.searchParams.set('corpsecret', runtimeConfig.corpSecret);

        const tokenResponse = await fetch(tokenUrl, { cache: 'no-store' });
        const token = (await tokenResponse.json()) as WecomAccessTokenResponse;

        assertWecomSuccess(token, 'Failed to fetch WeCom access token');

        if (!tokenResponse.ok || !token.access_token) {
          throw new Error(token.errmsg ?? 'WeCom access token response is missing access_token');
        }

        const userInfoUrl = new URL(WECOM_USERINFO_URL);
        userInfoUrl.searchParams.set('access_token', token.access_token);
        userInfoUrl.searchParams.set('code', code);

        const userInfoResponse = await fetch(userInfoUrl, { cache: 'no-store' });
        const authUser = (await userInfoResponse.json()) as WecomAuthUserResponse;

        assertWecomSuccess(authUser, 'Failed to fetch WeCom login user info');

        if (!userInfoResponse.ok || (!authUser.UserId && !authUser.OpenId)) {
          throw new Error(authUser.errmsg ?? 'WeCom user info response is missing user identity');
        }

        return {
          accessToken: token.access_token,
          accessTokenExpiresAt: token.expires_in
            ? new Date(Date.now() + token.expires_in * 1000)
            : undefined,
          expiresIn: token.expires_in,
          raw: { authUser, token } satisfies WecomTokenRaw,
          scopes: ['snsapi_login'],
          tokenType: 'Bearer',
        };
      },
      getUserInfo: async (tokens) => {
        await getWecomSsoRuntimeConfig();

        const accessToken = tokens.accessToken;
        const raw = (tokens as { raw?: WecomTokenRaw }).raw;
        const userId = raw?.authUser.UserId;
        const openId = raw?.authUser.OpenId;
        const fallbackId = userId ?? openId;

        if (!accessToken || !fallbackId) return null;

        let profile: WecomUserDetailResponse | undefined;

        if (userId) {
          const detailUrl = new URL(WECOM_USER_DETAIL_URL);
          detailUrl.searchParams.set('access_token', accessToken);
          detailUrl.searchParams.set('userid', userId);

          const response = await fetch(detailUrl, { cache: 'no-store' });
          if (response.ok) {
            const data = (await response.json()) as WecomUserDetailResponse;
            if (!hasWecomError(data)) profile = data;
          }
        }

        const finalId = profile?.userid ?? fallbackId;

        return {
          ...profile,
          email: profile?.email || `${finalId}@wecom.sso`,
          emailVerified: false,
          id: finalId,
          image: profile?.avatar,
          name: profile?.name ?? profile?.alias ?? finalId,
        };
      },
      pkce: false,
      providerId: 'wecom',
      responseMode: 'query',
      scopes: ['snsapi_login'],
      tokenUrl: WECOM_TOKEN_URL,
    };
  },

  checkEnvs: () => {
    return {
      AUTH_WECOM_AGENT_ID: authEnv.AUTH_WECOM_AGENT_ID ?? '',
      AUTH_WECOM_CORP_ID: authEnv.AUTH_WECOM_CORP_ID ?? '',
      AUTH_WECOM_CORP_SECRET: authEnv.AUTH_WECOM_CORP_SECRET ?? '',
    };
  },
  id: 'wecom',
  type: 'generic',
};

export default provider;
