// Synthetic model endpoint for isolated BDD acceptance. Contains no user data or credentials.
const http = require('node:http');
const attempts = new Map();
http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
    res.setHeader('Connection', 'close');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://fixture');
    const scenario = url.searchParams.get('scenario') || 'success';
    const key = `${url.searchParams.get('run')}:${scenario}`;
    const attempt = (attempts.get(key) || 0) + 1;
    attempts.set(key, attempt);
    console.log(JSON.stringify({ scenario, attempt, event: 'request' }));
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
        event('stop', 'stop');
        res.end();
        console.log(JSON.stringify({ scenario, attempt, event: 'completed' }));
      },
      scenario === 'slow' || scenario === 'stop' ? 5000 : 150,
    );
  })
  .listen(14321, '0.0.0.0', () => console.log('BDD fault endpoint ready on 14321'));
