/* eslint-disable @typescript-eslint/no-require-imports */

const http = require('node:http');

const blockedResponseHeaders = new Set(
  [
    'X-Invoke-Output',
    'X-Invoke-Path',
    'X-Invoke-Query',
    'X-Middleware-Rewrite',
    'X-Middleware-Set-Cookie',
    'X-Nextjs-Cache',
    'X-Nextjs-Matched-Path',
    'X-Nextjs-Prerender',
    'X-Nextjs-Rewritten-Path',
    'X-Nextjs-Rewritten-Query',
    'X-Nextjs-Stale-Time',
    'X-Powered-By',
  ].map((header) => header.toLowerCase()),
);

const filterHeaders = (headers) => {
  if (!headers) return headers;

  if (Array.isArray(headers)) {
    const filtered = [];

    for (let index = 0; index < headers.length; index += 2) {
      const name = String(headers[index]).toLowerCase();
      if (!blockedResponseHeaders.has(name)) {
        filtered.push(headers[index], headers[index + 1]);
      }
    }

    return filtered;
  }

  if (typeof headers !== 'object') return headers;

  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !blockedResponseHeaders.has(name.toLowerCase())),
  );
};

const installResponseHeaderHardening = () => {
  const prototype = http.ServerResponse.prototype;
  const installed = Symbol.for('masterino.responseHeaderHardening');

  if (prototype[installed]) return;

  const originalAppendHeader = prototype.appendHeader;
  const originalSetHeader = prototype.setHeader;
  const originalWriteHead = prototype.writeHead;

  prototype.setHeader = function setHeader(name, value) {
    if (blockedResponseHeaders.has(String(name).toLowerCase())) return this;
    return originalSetHeader.call(this, name, value);
  };

  if (originalAppendHeader) {
    prototype.appendHeader = function appendHeader(name, value) {
      if (blockedResponseHeaders.has(String(name).toLowerCase())) return this;
      return originalAppendHeader.call(this, name, value);
    };
  }

  prototype.writeHead = function writeHead(statusCode, statusMessage, headers) {
    for (const name of blockedResponseHeaders) {
      this.removeHeader(name);
    }

    if (typeof statusMessage === 'string') {
      return originalWriteHead.call(this, statusCode, statusMessage, filterHeaders(headers));
    }

    if (statusMessage === undefined) {
      return originalWriteHead.call(this, statusCode);
    }

    return originalWriteHead.call(this, statusCode, filterHeaders(statusMessage));
  };

  Object.defineProperty(prototype, installed, { value: true });
};

installResponseHeaderHardening();

module.exports = {
  blockedResponseHeaders,
  filterHeaders,
  installResponseHeaderHardening,
};
