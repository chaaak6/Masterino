import { URL } from 'node:url';

import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { authEnv } from '@/envs/auth';
import { defaultClients } from '@/libs/oidc-provider/config';
import { createNodeRequest, createNodeResponse } from '@/libs/oidc-provider/http-adapter';
import { getOIDCProvider } from '@/server/services/oidc/oidcProvider';

const log = debug('lobe-oidc:route'); // Create a debug instance with a namespace
const MAX_TOKEN_REQUEST_BYTES = 16 * 1024;
const TOKEN_ENDPOINT_PATH = '/oidc/token';

const getRegisteredBrowserOrigins = () => {
  const origins = new Set<string>();

  for (const client of defaultClients) {
    for (const candidate of [
      ...(client.redirect_uris ?? []),
      ...(client.post_logout_redirect_uris ?? []),
    ]) {
      try {
        const url = new URL(candidate);
        const isLoopback =
          url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
        if (process.env.NODE_ENV === 'production' && isLoopback) continue;
        if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
      } catch {
        // Native custom schemes do not participate in browser CORS.
      }
    }
  }

  return origins;
};

const isAllowedBrowserOrigin = (origin: string) => {
  try {
    return getRegisteredBrowserOrigins().has(new URL(origin).origin);
  } catch {
    return false;
  }
};

const appendVaryOrigin = (headers: Headers) => {
  const values = new Set(
    (headers.get('Vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  values.add('Origin');
  headers.set('Vary', [...values].join(', '));
};

const handler = async (req: NextRequest) => {
  const requestUrl = new URL(req.url);
  log(`Received ${req.method.toUpperCase()} request: %s %s`, req.method, req.url);
  log('Path: %s, Pathname: %s', requestUrl.pathname, requestUrl.pathname);

  // Declare the response collector
  let responseCollector;

  try {
    if (!authEnv.ENABLE_OIDC) {
      log('OIDC is not enabled');
      return new NextResponse('OIDC is not enabled', { status: 404 });
    }

    const requestOrigin = req.headers.get('origin');
    if (requestOrigin && !isAllowedBrowserOrigin(requestOrigin)) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Origin is not allowed' },
        {
          headers: { 'Cache-Control': 'no-store', 'Vary': 'Origin' },
          status: 403,
        },
      );
    }

    if (requestUrl.pathname === TOKEN_ENDPOINT_PATH && req.method === 'POST') {
      const contentLength = Number(req.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_TOKEN_REQUEST_BYTES) {
        return NextResponse.json(
          { error: 'invalid_request', error_description: 'Request body is too large' },
          { headers: { 'Cache-Control': 'no-store' }, status: 413 },
        );
      }
    }

    // Get the OIDC Provider instance
    const provider = await getOIDCProvider();

    log(`Calling provider.callback() for ${req.method}`); // Log the method
    await new Promise<void>((resolve, reject) => {
      // <-- Make promise callback async
      let middleware: any;
      try {
        log('Attempting to get middleware from provider.callback()');
        middleware = provider.callback();
        log('Successfully obtained middleware function.');
      } catch (syncError) {
        log('SYNC ERROR during provider.callback() call itself: %O', syncError);
        reject(syncError);
        return;
      }

      // Use helper method to create the response collector
      responseCollector = createNodeResponse(resolve);
      const nodeResponse = responseCollector.nodeResponse;

      // Use helper method to create the Node.js request object, now requires await
      createNodeRequest(req, {
        maxBodyBytes:
          requestUrl.pathname === TOKEN_ENDPOINT_PATH ? MAX_TOKEN_REQUEST_BYTES : undefined,
      }).then((nodeRequest) => {
        log('Calling the obtained middleware...');
        middleware(nodeRequest, nodeResponse, (error?: Error) => {
          log('Middleware callback function HAS BEEN EXECUTED.');
          if (error) {
            log('Middleware error reported via callback: %O', error);
            reject(error);
          } else {
            log(
              'Middleware completed successfully via callback (may be redundant if .end() was called).',
            );
            resolve();
          }
        });
        log('Middleware call initiated, waiting for its callback OR nodeResponse.end()...');
      }, reject);
    });

    log('Promise surrounding middleware call resolved.');

    // Access the final response status
    if (!responseCollector) {
      throw new Error('ResponseCollector was not initialized.');
    }

    const {
      responseStatus: finalStatus,
      responseBody: finalBody,
      responseHeaders: finalHeaders,
    } = responseCollector;

    log('Final Response Status: %d', finalStatus);
    log('Final Response Headers: %O', finalHeaders);

    const responseHeaders = new Headers(finalHeaders as HeadersInit);
    const responseOrigin = responseHeaders.get('Access-Control-Allow-Origin');

    // oidc-provider uses "*" when a non-browser client omits Origin. Do not
    // advertise wildcard browser access for server/native token requests.
    if (!requestOrigin) {
      responseHeaders.delete('Access-Control-Allow-Origin');
    } else if (responseOrigin) {
      responseHeaders.set('Access-Control-Allow-Origin', requestOrigin);
      appendVaryOrigin(responseHeaders);
    }

    return new NextResponse(finalBody, {
      headers: responseHeaders,
      status: finalStatus,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'OIDCRequestBodyTooLargeError') {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Request body is too large' },
        { headers: { 'Cache-Control': 'no-store' }, status: 413 },
      );
    }

    log(`Error handling OIDC ${req.method} request: %O`, error); // Log method in error
    return NextResponse.json(
      { error: 'server_error', error_description: 'The authorization server failed the request' },
      { headers: { 'Cache-Control': 'no-store' }, status: 500 },
    );
  }
};

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
