import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AihubBridgeRepository } from './repository.js';
import type { BoundTokenPatch } from './types.js';

interface HandlerOptions {
  bridgeToken: string;
  iamProviderId: number;
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

const isDatabaseWriteForbidden = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code || '');
  const message = error instanceof Error ? error.message : String(error);
  return (
    ['42501', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'].includes(code) ||
    /permission denied|command denied|access denied/i.test(message)
  );
};

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

const tokenPatchFields = new Set([
  'allow_ips',
  'expired_time',
  'group',
  'model_limits',
  'model_limits_enabled',
  'remain_quota',
  'status',
  'unlimited_quota',
]);

const parseBoundTokenPatch = (body: unknown): BoundTokenPatch | undefined => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const patch = body as Record<string, unknown>;
  const entries = Object.entries(patch);
  if (!entries.length || entries.some(([key]) => !tokenPatchFields.has(key))) return undefined;
  if (
    entries.some(([key, value]) => {
      if (key === 'status') return value !== 1 && value !== 2;
      if (key === 'expired_time')
        return !Number.isSafeInteger(value) || (value as number) < -1 || value === 0;
      if (key === 'remain_quota') return !Number.isSafeInteger(value) || (value as number) < 0;
      if (key === 'model_limits_enabled' || key === 'unlimited_quota')
        return typeof value !== 'boolean';
      if (key === 'group') return typeof value !== 'string' || value.length > 64;
      return typeof value !== 'string' || value.length > 5000;
    })
  )
    return undefined;
  return patch as BoundTokenPatch;
};

const inspectionResponse = (
  inspection: Awaited<ReturnType<AihubBridgeRepository['inspectBoundToken']>>,
) => {
  if (inspection.availability === 'missing')
    return failure(404, 'token_missing', 'Bound token was not found');
  if (inspection.availability === 'owner_mismatch')
    return failure(409, 'owner_mismatch', 'Bound token belongs to another Aihub user');
  if (inspection.availability === 'deleted')
    return failure(410, 'token_deleted', 'Bound token was deleted');
  return success(inspection);
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
  iamProviderId,
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
        if (!email && !username)
          return failure(400, 'bad_request', 'email or username is required');

        const user = await repository.findUserByIdentity({ email, username });
        if (!user) return failure(404, 'not_found', 'Aihub user was not found');

        return success(user);
      }

      const userId = parseUserId(url.pathname);

      // Token reassignment route — checked before the userId early-return
      // because /v1/tokens/:id/* doesn't match the /v1/users/:id/* pattern.
      const tokenId = parseTokenId(url.pathname);
      if (
        tokenId &&
        url.pathname === `/v1/tokens/${tokenId}/reassign` &&
        request.method === 'POST'
      ) {
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
          return failure(404, 'not_found', 'Token was not found or could not be reassigned');
        }

        // Optionally update the token name in the same request.
        if (typeof body.name === 'string' && body.name.trim()) {
          await repository.updateTokenName(tokenId, body.name.trim());
        }

        return success({ ok: true });
      }

      if (!userId) return failure(404, 'not_found', 'Endpoint was not found');

      if (url.pathname === `/v1/users/${userId}/oauth-binding` && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          providerId?: unknown;
          providerUserId?: unknown;
        };

        const providerId =
          typeof body.providerId === 'number' ? body.providerId : Number(body.providerId);
        const providerUserId =
          typeof body.providerUserId === 'string' ? body.providerUserId.trim() : '';

        const effectiveProviderId =
          Number.isInteger(providerId) && providerId > 0 ? providerId : iamProviderId;

        if (!Number.isInteger(effectiveProviderId) || effectiveProviderId <= 0) {
          return failure(400, 'bad_request', 'providerId must be a positive integer');
        }
        if (!providerUserId) {
          return failure(400, 'bad_request', 'providerUserId must be a non-empty string');
        }

        try {
          const result = await repository.linkOAuthBinding(
            userId,
            effectiveProviderId,
            providerUserId,
          );
          if (result.status === 'conflict') {
            return failure(409, 'binding_conflict', result.reason);
          }

          return success(result);
        } catch (error) {
          if (isDatabaseWriteForbidden(error)) {
            return failure(403, 'database_write_forbidden', 'Database write is not permitted');
          }
          throw error;
        }
      }

      if (url.pathname === `/v1/users/${userId}/oauth-binding` && request.method === 'GET') {
        const providerId = Number(url.searchParams.get('providerId'));
        const providerUserId = url.searchParams.get('providerUserId')?.trim() || '';
        const effectiveProviderId =
          Number.isInteger(providerId) && providerId > 0 ? providerId : iamProviderId;
        if (!providerUserId) {
          return failure(400, 'bad_request', 'providerUserId is required');
        }
        return success(
          await repository.inspectOAuthBinding(userId, effectiveProviderId, providerUserId),
        );
      }

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

      const managedTokenByIdMatch = url.pathname.match(
        new RegExp(`^/v1/users/${userId}/managed-tokens/(\\d+)$`),
      );

      const boundTokenInspectionMatch = url.pathname.match(
        new RegExp(`^/v1/users/${userId}/managed-tokens/(\\d+)/inspection$`),
      );
      if (boundTokenInspectionMatch && request.method === 'GET') {
        return inspectionResponse(
          await repository.inspectBoundToken(userId, Number(boundTokenInspectionMatch[1])),
        );
      }
      if (managedTokenByIdMatch && request.method === 'PATCH') {
        const patch = parseBoundTokenPatch(await request.json().catch(() => undefined));
        if (!patch) return failure(400, 'bad_request', 'Invalid bound token settings');
        try {
          return inspectionResponse(
            await repository.updateBoundToken(userId, Number(managedTokenByIdMatch[1]), patch),
          );
        } catch (error) {
          if (isDatabaseWriteForbidden(error))
            return failure(403, 'database_write_forbidden', 'Database write is not permitted');
          throw error;
        }
      }
      if (managedTokenByIdMatch) {
        const managedTokenId = Number(managedTokenByIdMatch[1]);
        const token = await repository.findManagedTokenById(userId, managedTokenId);
        if (!token) {
          return failure(
            404,
            'not_found',
            'Aihub managed token was not found, inactive, expired, or owned by another user',
          );
        }

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
