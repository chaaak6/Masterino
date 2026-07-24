// @vitest-environment node

import '../_shared/hardenResponseHeaders';

import { createServer } from 'node:http';

describe('response header hardening', () => {
  it('removes internal framework headers from setHeader and writeHead', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('X-Nextjs-Cache', 'HIT');
      response.setHeader('X-Custom-Header', 'kept');
      response.writeHead(200, {
        'X-Middleware-Rewrite': '/internal',
        'X-Powered-By': 'Next.js',
      });
      response.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('server address unavailable');

      const response = await fetch(`http://127.0.0.1:${address.port}`);

      expect(response.headers.get('x-nextjs-cache')).toBeNull();
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
      expect(response.headers.get('x-powered-by')).toBeNull();
      expect(response.headers.get('x-custom-header')).toBe('kept');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
