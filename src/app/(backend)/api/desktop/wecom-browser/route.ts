import { createHash, randomBytes } from 'node:crypto';

import { appEnv } from '@/envs/app';
import { getRequestOrigin } from '@/libs/url/requestOrigin';
import { getWecomSsoRuntimeConfig } from '@/server/services/enterprise/wecomSsoService';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

async function wecomRequest(path: string, params: Record<string, string>) {
  const url = new URL(path, 'https://qyapi.weixin.qq.com');
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  const data = await response.json();
  if (!response.ok || data.errcode) throw new Error('WeCom SDK configuration unavailable');
  return data;
}

export async function POST(request: Request) {
  try {
    const { auth } = await import('@/auth');
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return Response.json({ error: 'Unauthorized' }, { headers, status: 401 });
    const { url: rawUrl } = await request.json();
    const url = new URL(rawUrl);
    if (!appEnv.APP_URL) throw new Error('Application URL unavailable');
    const origin = getRequestOrigin(request, { fallbackUrl: appEnv.APP_URL });
    if (
      url.origin !== origin ||
      request.headers.get('origin') !== origin ||
      url.username ||
      url.password
    )
      return Response.json({ error: 'Invalid page origin' }, { headers, status: 400 });
    url.hash = '';
    const { corpId, agentId, corpSecret } = await getWecomSsoRuntimeConfig();
    const token = await wecomRequest('/cgi-bin/gettoken', {
      corpid: corpId,
      corpsecret: corpSecret,
    });
    if (!token.access_token) throw new Error('Missing access token');
    const [corp, agent] = await Promise.all([
      wecomRequest('/cgi-bin/get_jsapi_ticket', { access_token: token.access_token }),
      wecomRequest('/cgi-bin/ticket/get', {
        access_token: token.access_token,
        type: 'agent_config',
      }),
    ]);
    if (!corp.ticket || !agent.ticket) throw new Error('Missing SDK ticket');
    const nonceStr = randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = (ticket: string) =>
      createHash('sha1')
        .update(
          `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url.href}`,
        )
        .digest('hex');
    return Response.json(
      {
        corpId,
        agentId,
        nonceStr,
        timestamp,
        signature: signature(corp.ticket),
        agentSignature: signature(agent.ticket),
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: 'WeCom SDK configuration unavailable' },
      { headers, status: 503 },
    );
  }
}

// Serve the fixed official SDK from the same origin so the existing CSP stays effective.
export async function GET() {
  try {
    const response = await fetch('https://open.work.weixin.qq.com/wwopen/js/jwxwork-1.0.0.js', {
      next: { revalidate: 86400 },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('SDK unavailable');
    return new Response(await response.text(), {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('SDK unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
