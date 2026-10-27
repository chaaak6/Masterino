import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    directory: { type: 'string', default: path.join(os.tmpdir(), 'masterino-update-fixture') },
    init: { type: 'boolean' },
    installer: { type: 'string' },
    version: { type: 'string' },
    platform: { type: 'string', default: 'darwin-arm64' },
    port: { type: 'string', default: '19381' },
    mode: { type: 'string' },
  },
});
const directory = path.resolve(values.directory);
const modes = ['normal', 'invalid-signature', 'corrupt', '503', 'cut', 'stall'];
mkdirSync(directory, { recursive: true, mode: 0o700 });
if (values.mode) {
  if (!modes.includes(values.mode)) throw new Error(`Mode must be ${modes.join(', ')}`);
  writeFileSync(path.join(directory, 'control.json'), JSON.stringify({ mode: values.mode }));
  console.log(`Fixture mode: ${values.mode}`);
  process.exit(0);
}
const keyFile = path.join(directory, 'keys.json');
if (!existsSync(keyFile)) {
  const pair = generateKeyPairSync('ed25519');
  writeFileSync(
    keyFile,
    JSON.stringify({
      keyId: 'masterino-local-fixture',
      privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    }),
    { mode: 0o600, flag: 'wx' },
  );
}
const keys = JSON.parse(readFileSync(keyFile, 'utf8'));
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
const session = {
  keyId: keys.keyId,
  publicKey: keys.publicKey,
  origin: `http://127.0.0.1:${port}`,
};
writeFileSync(path.join(directory, 'session.json'), JSON.stringify(session, null, 2));
if (values.init) {
  console.log(JSON.stringify(session, null, 2));
  process.exit(0);
}
if (!values.installer || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(values.version ?? '')) {
  throw new Error(
    'Provide --installer <test installer> --version <B version>; use --init before building A/B',
  );
}
const installer = path.resolve(values.installer);
const size = statSync(installer).size;
const digest = createHash('sha512');
for await (const chunk of createReadStream(installer)) digest.update(chunk);
const sha512 = digest.digest('base64');
const hash = (bytes) => createHash('sha512').update(bytes).digest('base64');
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value);
const targets = [
  ['darwin', 'arm64', '.dmg'],
  ['darwin', 'x64', '.dmg'],
  ['win32', 'x64', '.exe'],
];
if (!targets.some(([p, a]) => `${p}-${a}` === values.platform))
  throw new Error('Invalid target platform');
const artifactPath = (p, a, ext) => `canary/${values.version}/update-${p}-${a}${ext}`;
const supported = targets.find(([p, a]) => `${p}-${a}` === values.platform);
const downloadPath = `/desktop/releases/${artifactPath(...supported)}`;
const log = (entry) =>
  writeFileSync(path.join(directory, 'requests.ndjson'), `${JSON.stringify(entry)}\n`, {
    flag: 'a',
  });
const mode = () => {
  try {
    return JSON.parse(readFileSync(path.join(directory, 'control.json'), 'utf8')).mode || 'normal';
  } catch {
    return 'normal';
  }
};
const envelope = (currentMode) => {
  const artifacts = targets.map(([platform, arch, ext]) => ({
    platform,
    arch,
    path: artifactPath(platform, arch, ext),
    // Unprovided platforms are declared to satisfy the format but always return HTTP 404.
    size:
      `${platform}-${arch}` !== values.platform
        ? 1
        : currentMode === 'corrupt'
          ? 2 * 1024 * 1024
          : size,
    sha512:
      `${platform}-${arch}` !== values.platform
        ? hash(Buffer.alloc(1))
        : currentMode === 'corrupt'
          ? hash(Buffer.alloc(2 * 1024 * 1024))
          : sha512,
  }));
  const payload = Buffer.from(
    canonical({
      artifacts,
      channel: 'canary',
      version: values.version,
      releaseDate: new Date().toISOString(),
      releaseNotes: 'Local test fixture: manual download, progress, cancellation and installation.',
    }),
  );
  return JSON.stringify({
    algorithm: 'Ed25519',
    keyId: keys.keyId,
    payload: payload.toString('base64'),
    signature:
      currentMode === 'invalid-signature'
        ? Buffer.alloc(64).toString('base64')
        : sign(null, payload, keys.privateKey).toString('base64'),
  });
};
createServer(async (request, response) => {
  const currentMode = mode();
  const entry = {
    time: new Date().toISOString(),
    url: request.url,
    method: request.method,
    mode: currentMode,
    bytes: 0,
  };
  log(entry);
  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end();
    return;
  }
  if (request.url === '/desktop/releases/canary/canary.json') {
    response.setHeader('Content-Type', 'application/json');
    response.end(envelope(currentMode));
    return;
  }
  if (request.url !== downloadPath) {
    response.writeHead(404);
    response.end();
    return;
  }
  if (currentMode === '503') {
    response.writeHead(503);
    response.end('Injected failure');
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': currentMode === 'corrupt' ? 2 * 1024 * 1024 : size,
  });
  response.flushHeaders();
  const stream =
    currentMode === 'corrupt'
      ? undefined
      : createReadStream(installer, { highWaterMark: 512 * 1024 });
  response.on('close', () => {
    stream?.destroy();
    log({ ...entry, closed: true });
  });
  if (currentMode === 'stall') return;
  try {
    if (currentMode === 'corrupt') {
      entry.bytes = 2 * 1024 * 1024;
      response.end(Buffer.alloc(entry.bytes, 1));
      return;
    }
    for await (const chunk of stream) {
      await delay(60);
      if (response.destroyed) break;
      if (currentMode === 'cut' && entry.bytes >= 2 * 1024 * 1024) {
        response.destroy();
        break;
      }
      entry.bytes += chunk.length;
      response.write(chunk);
    }
    if (!response.destroyed) response.end();
  } catch {
    response.destroy();
  }
}).listen(port, '127.0.0.1', () =>
  console.log(
    JSON.stringify({ ...session, version: values.version, platform: values.platform, size, modes }),
  ),
);
