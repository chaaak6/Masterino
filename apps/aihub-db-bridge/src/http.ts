import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AihubBridgeRepository } from './repository.js';

interface HandlerOptions {
  bridgeToken: string;
  managedTokenName: string;
  repository: AihubBridgeRepository;
}

type BridgeHandler = (request: Request) => Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    status,
  });

const success = (data: unknown, status = 200) => json({ data, success: true }, status);

const failure = (status: number, code: string, message: string) =>
  json({ error: { code, message }, success: false }, status);

const parsePositiveInt = (value: string | null, fallback?: number) => {
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;

  return parsed;
};

const parseUserId = (pathname: string) => {
  const match = pathname.match(/^\/v1\/users\/(\d+)(?:\/|$)/);
  if (!match) return undefined;

  return Number(match[1]);
};

const parseTokenId = (pathname: string) => {
  const match = pathname.match(/^\/v1\/tokens\/(\d+)(?:\/|$)/);
  if (!match) return undefined;

  return Number(match[1]);
};

const isAuthorized = (request: Request, bridgeToken: string) => {
  const header = request.headers.get('authorization') || '';

  return header === `Bearer ${bridgeToken}`;
};

const requestHeadersToWebHeaders = (request: IncomingMessage) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  return headers;
};

export const createBridgeHandler = ({
  bridgeToken,
  managedTokenName,
  repository,
}: HandlerOptions): BridgeHandler => {
  return async (request) => {
    if (!isAuthorized(request, bridgeToken)) return failure(401, 'unauthorized', 'Unauthorized');

    const url = new URL(request.url);

    try {
      if (url.pathname === '/health') {
        if (url.searchParams.get('deep') === '1') {
          await repository.findUserById(0).catch(() => undefined);
        }

        return success({ ok: true });
      }

      if (url.pathname === '/v1/users/resolve') {
        const email = url.searchParams.get('email') || undefined;
        const username = url.searchParams.get('username') || undefined;
        if (!email && !username) return failure(400, 'bad_request', 'email or username is required');

        const user = await repository.findUserByIdentity({ email, username });
        if (!user) return failure(404, 'not_found', 'Aihub user was not found');

        return success(user);
      }

      const userId = parseUserId(url.pathname);

      // Token reassignment route — checked before the userId early-return
      // because /v1/tokens/:id/* doesn't match the /v1/users/:id/* pattern.
      const tokenId = parseTokenId(url.pathname);
      if (tokenId && url.pathname === `/v1/tokens/${tokenId}/reassign` && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          name?: unknown;
          userId?: unknown;
        };
        const targetUserId = typeof body.userId === 'number' ? body.userId : Number(body.userId);

        if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
          return failure(400, 'bad_request', 'userId must be a positive integer');
        }

        const ok = await repository.reassignToken(tokenId, targetUserId);
        if (!ok) {
          return failure(
            404,
            'not_found',
            'Token was not found or could not be reassigned',
          );
        }

        // Optionally update the token name in the same request.
        if (typeof body.name === 'string' && body.name.trim()) {
          await repository.updateTokenName(tokenId, body.name.trim());
        }

        return success({ ok: true });
      }

      if (!userId) return failure(404, 'not_found', 'Endpoint was not found');

      if (url.pathname === `/v1/users/${userId}`) {
        const user = await repository.findUserById(userId);
        if (!user) return failure(404, 'not_found', 'Aihub user was not found');

        return success(user);
      }

      if (url.pathname === `/v1/users/${userId}/managed-token`) {
        const tokenName = url.searchParams.get('name') || managedTokenName;
        const token = await repository.findManagedToken(userId, tokenName);
        if (!token) return failure(404, 'not_found', 'Aihub managed token was not found');

        return success(token);
      }

      if (url.pathname === `/v1/users/${userId}/managed-tokens`) {
        const tokenName = url.searchParams.get('name') || managedTokenName;
        const tokens = await repository.listManagedTokens(userId, tokenName);

        return success(tokens);
      }

      if (url.pathname === `/v1/users/${userId}/models`) {
        const tokenName = url.searchParams.get('tokenName') || managedTokenName;
        const [user, token] = await Promise.all([
          repository.findUserById(userId),
          repository.findManagedToken(userId, tokenName),
        ]);
        const models = await repository.listAccessibleModels(user?.group, token);

        return success(models);
      }

      if (url.pathname === `/v1/users/${userId}/usage-logs`) {
        const page = parsePositiveInt(url.searchParams.get('page'), 1);
        const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 100);
        const startTimestamp = parsePositiveInt(url.searchParams.get('startTimestamp'), 0);
        const endTimestamp = parsePositiveInt(url.searchParams.get('endTimestamp'));

        if (!page || !pageSize || startTimestamp === undefined) {
          return failure(400, 'bad_request', 'Invalid usage log query parameters');
        }

        const logs = await repository.getUsageLogs(userId, {
          endTimestamp,
          page,
          pageSize,
          startTimestamp,
        });

        return success(logs);
      }

      return failure(404, 'not_found', 'Endpoint was not found');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return failure(500, 'internal_error', message);
    }
  };
};

export const handleNodeRequest =
  (handler: BridgeHandler) => async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));

    const host = request.headers.host || 'localhost';
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const webRequest = new Request(`http://${host}${request.url || '/'}`, {
      body,
      headers: requestHeadersToWebHeaders(request),
      method: request.method,
    });
    const webResponse = await handler(webRequest);
    const responseBody = Buffer.from(await webResponse.arrayBuffer());

    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    response.end(responseBody);
  };
