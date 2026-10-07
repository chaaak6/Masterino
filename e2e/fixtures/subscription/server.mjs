// Test-only static host: synthetic data, no database or account writes.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve(process.env.PREVIEW_DIST || '/tmp/subscription-ui-web');
const subscription = {
  id: 1,
  title: '通用订阅 · 每月重置额度',
  status: 'active',
  amountTotal: 50000000,
  amountUsed: 7685000,
  startTime: 1790730919,
  endTime: 1822266919,
  nextResetTime: 1793462400,
  resetAmount: 50000000,
  allowWalletOverflow: true,
};
const account = {
  username: 'TEST-0001',
  group: 'vip',
  quota: 49992143,
  usedQuota: 7685000,
  requestCount: 3906,
  quotaPolicy: { quotaPerUnit: 500000, usdExchangeRate: 7, quotaDisplayType: 'CNY' },
};
createServer(async (req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }
  const url = new URL(req.url, 'http://preview');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname.startsWith('/fixture/')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        url.pathname === '/fixture/account'
          ? account
          : { billingPreference: 'subscription_first', subscriptions: [subscription] },
      ),
    );
    return;
  }
  const filename = path.resolve(root, `.${url.pathname}`);
  if (!filename.startsWith(root + '/')) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const data = await readFile(filename);
    res.setHeader(
      'Content-Type',
      { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' }[
        path.extname(filename)
      ] || 'application/octet-stream',
    );
    res.end(data);
  } catch {
    res.setHeader('Content-Type', 'text/html');
    res.end(await readFile(path.resolve(root, 'index.html')));
  }
}).listen(Number(process.env.PORT || 3224), '0.0.0.0');
