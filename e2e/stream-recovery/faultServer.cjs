// Synthetic model endpoint for isolated BDD acceptance. Contains no user data or credentials.
// Standalone CommonJS fixture is launched directly with Node.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('node:http');

const attempts = new Map();
http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-Masterino-Stream-Protocol');
    res.setHeader('Connection', 'close');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://fixture');
    const scenario = url.searchParams.get('scenario') || 'success';
    if (scenario !== 'legacy-eof') res.setHeader('X-Masterino-Stream-Protocol', 'terminal-v1');
    const key = `${url.searchParams.get('run') ?? url.searchParams.get('operationId')}:${scenario}`;
    const attempt = (attempts.get(key) || 0) + 1;
    attempts.set(key, attempt);
    console.log(JSON.stringify({ scenario, attempt, event: 'request' }));
    if (scenario === 'snapshot') {
      res.setHeader('Content-Type', 'application/json');
      const fail = key.includes('sync-fail') && attempt === 1;
      setTimeout(
        () => {
          res.writeHead(fail ? 503 : 200);
          res.end(
            JSON.stringify(
              fail
                ? { error: 'snapshot unavailable' }
                : [
                    {
                      id: 'stream-bdd-message',
                      role: 'assistant',
                      content: 'Saved report',
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    },
                  ],
            ),
          );
        },
        key.includes('snapshot-timeout') ? 6500 : key.includes('snapshot-cancel') ? 1500 : 300,
      );
      return;
    }
    if (scenario.startsWith('gateway-')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const operationId = url.searchParams.get('operationId');
      const send = (type, data) =>
        res.write(
          `id: ${attempt}-${type}\ndata: ${JSON.stringify({ id: `${attempt}-${type}`, operationId, type, data, stepIndex: 0, timestamp: Date.now() })}\n\n`,
        );
      if (scenario === 'gateway-immediate' || (scenario === 'gateway-quiet' && attempt === 1)) {
        res.end(': heartbeat\n\n');
      } else if (scenario === 'gateway-quiet' && attempt === 2) {
        const timer = setInterval(() => res.write(': heartbeat\n\n'), 1000);
        res.on('close', () => clearInterval(timer));
        setTimeout(() => {
          clearInterval(timer);
          res.end();
        }, 31_000);
      } else {
        send('stream_chunk', { chunkType: 'text', content: 'Report complete' });
        setTimeout(
          () => {
            if (scenario === 'gateway-late-error' || scenario === 'gateway-error')
              send('error', { message: 'late server failure' });
            else
              send(
                'agent_runtime_end',
                [
                  'gateway-sync-fail',
                  'gateway-snapshot-cancel',
                  'gateway-snapshot-timeout',
                ].includes(scenario)
                  ? {}
                  : {
                      uiMessages: [
                        { id: 'stream-bdd-message', role: 'assistant', content: 'Saved report' },
                      ],
                    },
              );
            res.end();
          },
          scenario === 'gateway-late-error' ? 1500 : 150,
        );
      }
      return;
    }
    if (scenario === 'wrapped-rate-limit' && attempt === 1) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Retry-After': '0' });
      res.end(
        JSON.stringify({
          errorType: 'InternalServerError',
          body: { retryable: true, retryAfterMs: 0, error: { status: 429 } },
        }),
      );
      return;
    }
    if (
      [
        'ECONNREFUSED',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'socket-hang-up',
        'nested-503',
        'server-retryable',
        'quota',
      ].includes(scenario) &&
      (attempt === 1 || scenario === 'quota')
    ) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          errorType: 'InternalServerError',
          body: {
            ...(scenario === 'server-retryable' ? { retryable: true } : {}),
            ...(scenario === 'quota' ? { retryable: false } : {}),
            error:
              scenario === 'socket-hang-up'
                ? { message: 'socket hang up' }
                : scenario === 'nested-503'
                  ? { status: 503 }
                  : { code: scenario },
          },
        }),
      );
      return;
    }
    if (scenario === 'unauthorized') {
      res.writeHead(401);
      res.end();
      return;
    }
    if (scenario === 'too-large') {
      res.writeHead(413);
      res.end();
      return;
    }
    if (scenario === 'rate-limit' && attempt === 1) {
      res.writeHead(429, { 'Retry-After': '0' });
      res.end();
      return;
    }
    if (scenario === 'transient' && attempt < 3) {
      res.writeHead(503);
      res.end();
      return;
    }
    if (scenario === 'nonstream') {
      res.end('Complete report');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    if (scenario === 'malformed') {
      res.end('event: text\ndata: invalid-json\n\n');
      return;
    }
    event('text', scenario === 'eof-recovery' && attempt === 1 ? 'Discarded partial' : 'Report');
    if (scenario === 'legacy-eof') {
      res.end();
      return;
    }
    if (scenario === 'always-eof' || (scenario === 'eof-recovery' && attempt === 1)) {
      res.end();
      return;
    }
    if (scenario === 'reset-recovery' && attempt === 1) {
      setTimeout(() => res.destroy(), 100);
      return;
    }
    if (scenario === 'provider-error') {
      event('error', { type: 'ProviderBizError', message: 'Fixture provider rejection' });
      res.end();
      return;
    }
    setTimeout(
      () => {
        if (res.destroyed) return;
        event('text', ' complete');
        event('stop', ['length', 'MAX_TOKENS'].includes(scenario) ? scenario : 'stop');
        res.end();
        console.log(JSON.stringify({ scenario, attempt, event: 'completed' }));
      },
      scenario === 'slow' || scenario === 'stop' ? 5000 : 150,
    );
  })
  .listen(14321, '0.0.0.0', () => console.log('BDD fault endpoint ready on 14321'));
