import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'dotenv';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const stateDir = path.join(root, '.local-dev');
export const configFile = path.join(stateDir, 'config.env');
export const stateFile = path.join(stateDir, 'instance.json');
export type Instance = {
  id: string;
  password: string;
  authSecret: string;
  vaultSecret: string;
  gatewayToken: string;
  jwks: string;
  publicJwks: string;
};
const secret = () => randomBytes(32).toString('hex');
const defaults = {
  AIHUB_BASE_URL: 'https://aihub.bielcrystal.com/v1',
  AIHUB_API_KEY: '',
  CHAT_MODEL: 'deepseek-v4-flash',
  EMBEDDING_MODEL: 'text-embedding-3-large',
  MEMORY_ENABLED: '1',
  WEB_PORT: '3010',
  NEXT_PORT: '3011',
  VITE_PORT: '9876',
  POSTGRES_PORT: '15432',
  REDIS_PORT: '16379',
  S3_PORT: '19000',
  S3_CONSOLE_PORT: '19001',
  GATEWAY_PORT: '8788',
  SEARCH_PORT: '18180',
  QSTASH_PORT: '18080',
  SEARCH_ENABLED: '0',
};
export function initialize() {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  for (const dir of ['logs', 'reports', 'empty-env'])
    mkdirSync(path.join(stateDir, dir), { recursive: true, mode: 0o700 });
  if (!existsSync(configFile)) {
    writeFileSync(
      configFile,
      '# Local development only. Never commit credentials.\n' +
        Object.entries(defaults)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join('\n') +
        '\n',
      { mode: 0o600 },
    );
  }
  if (!existsSync(stateFile)) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = randomUUID();
    const jwk = (key: typeof privateKey) => ({
      ...key.export({ format: 'jwk' }),
      kid,
      use: 'sig',
      alg: 'RS256',
    });
    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          id: randomBytes(6).toString('hex'),
          password: secret(),
          authSecret: secret(),
          vaultSecret: randomBytes(32).toString('base64'),
          gatewayToken: secret(),
          jwks: JSON.stringify({ keys: [jwk(privateKey)] }),
          publicJwks: JSON.stringify({ keys: [jwk(publicKey)] }),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  chmodSync(configFile, 0o600);
  chmodSync(stateFile, 0o600);
}
export function validateConfig(input: Record<string, string>) {
  for (const k of Object.keys(input))
    if (!(k in defaults))
      throw new Error(
        `Unknown local setting ${k}; backend/database URLs are derived, not accepted as overrides.`,
      );
  const c = { ...defaults, ...input };
  const ports = Object.entries(c)
    .filter(([k]) => k.endsWith('_PORT'))
    .map(([k, v]) => {
      if (!/^\d+$/.test(v) || +v < 1024 || +v > 65535) throw new Error(`Invalid ${k}`);
      return +v;
    });
  if (new Set(ports).size !== ports.length)
    throw new Error('Local service ports must be distinct.');
  const url = new URL(c.AIHUB_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error(
      'AIHUB_BASE_URL must be an HTTPS API URL without credentials, query or fragment.',
    );
  for (const k of ['MEMORY_ENABLED', 'SEARCH_ENABLED'] as const)
    if (!['0', '1'].includes(c[k])) throw new Error(`Invalid ${k}`);
  return c;
}
export function loadConfig() {
  if (!existsSync(stateFile)) throw new Error('Run pnpm dev:local:setup first.');
  const c = validateConfig(parse(readFileSync(configFile)));
  const instance = JSON.parse(readFileSync(stateFile, 'utf8')) as Instance;
  if (!/^[a-f0-9]{12}$/.test(instance.id)) throw new Error('Invalid local instance ID');
  return {
    c,
    instance,
    project: `masterino-local-${instance.id}`,
    origin: `http://localhost:${c.WEB_PORT}`,
  };
}
export type LocalConfig = ReturnType<typeof loadConfig>;
export function systemEnvironment(
  input: Record<string, string | undefined> = process.env,
): NodeJS.ProcessEnv {
  const keys = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'COMSPEC',
    'PATHEXT',
    'LANG',
    'LC_ALL',
    'TERM',
    'COLORTERM',
    'SSH_AUTH_SOCK',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG',
  ];
  // Next augments ProcessEnv with required browser build flags. A child-process
  // environment is intentionally filtered and need not contain those application flags.
  return Object.fromEntries(
    keys.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]),
  ) as NodeJS.ProcessEnv;
}
export function localEnvironment(config: LocalConfig): NodeJS.ProcessEnv {
  const { c, instance: i, origin } = config;
  return {
    ...systemEnvironment(),
    NODE_ENV: 'development',
    MASTERINO_DEV_ENV: 'local',
    // @next/env honours this marker. The launcher supplies the complete environment;
    // repo .env files must not fill gaps with remote credentials (covered by tests).
    __NEXT_PROCESSED_ENV: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
    RAYON_NUM_THREADS: '2',
    NODE_OPTIONS: '--max-old-space-size=3072',
    APP_URL: origin,
    // Docker callbacks and host-side requests use the same internal URL. The
    // local Next preloader resolves Docker's host alias to loopback on the host.
    INTERNAL_APP_URL: `http://host.docker.internal:${c.NEXT_PORT}`,
    UPSTASH_WORKFLOW_URL: `http://host.docker.internal:${c.NEXT_PORT}`,
    QSTASH_URL: `http://127.0.0.1:${c.QSTASH_PORT}`,
    APP_URL_ALLOWED_HOSTS: new URL(origin).host,
    PORT: c.WEB_PORT,
    NEXT_INTERNAL_PORT: c.NEXT_PORT,
    VITE_DEV_PORT: c.VITE_PORT,
    VITE_DEV_INTERNAL_ORIGIN: `http://localhost:${c.VITE_PORT}`,
    VITE_DEV_PUBLIC_SAME_ORIGIN: '1',
    DATABASE_DRIVER: 'node',
    DATABASE_URL: `postgresql://postgres:${i.password}@127.0.0.1:${c.POSTGRES_PORT}/masterino_local`,
    REDIS_URL: `redis://127.0.0.1:${c.REDIS_PORT}`,
    REDIS_PREFIX: `local-${i.id}`,
    REDIS_ENABLED: '1',
    REDIS_TLS: '0',
    AUTH_SECRET: i.authSecret,
    KEY_VAULTS_SECRET: i.vaultSecret,
    JWKS_KEY: i.jwks,
    AUTH_SSO_PROVIDERS: '',
    AUTH_TRUSTED_ORIGINS: origin,
    AUTH_EMAIL_VERIFICATION: '0',
    AUTH_DISABLE_EMAIL_PASSWORD: '0',
    AUTH_DISABLE_EMAIL_SIGNUP: '0',
    ENABLE_OIDC: '1',
    DEVICE_GATEWAY_URL: `http://localhost:${c.GATEWAY_PORT}`,
    DEVICE_GATEWAY_SERVICE_TOKEN: i.gatewayToken,
    GATEWAY_MANAGER_DISABLED: '1',
    S3_ENDPOINT: `http://127.0.0.1:${c.S3_PORT}`,
    S3_PUBLIC_DOMAIN: `http://localhost:${c.S3_PORT}/masterino-local`,
    S3_ACCESS_KEY_ID: 'masterino-local',
    S3_SECRET_ACCESS_KEY: i.password,
    S3_BUCKET: 'masterino-local',
    S3_REGION: 'us-east-1',
    S3_ENABLE_PATH_STYLE: '1',
    S3_SET_ACL: '0',
    LLM_VISION_IMAGE_USE_BASE64: '1',
    AIHUB_PROXY_URL: new URL(c.AIHUB_BASE_URL).origin,
    MODEL_PROVIDER_ALLOWED_ORIGINS: new URL(c.AIHUB_BASE_URL).origin,
    NEWAPI_API_KEY: c.AIHUB_API_KEY,
    NEWAPI_PROXY_URL: c.AIHUB_BASE_URL,
    DEFAULT_AGENT_CONFIG: `model=${c.CHAT_MODEL};provider=newapi`,
    NEXT_PUBLIC_MARKET_BASE_URL: `${origin}/__local-dev/unavailable-market`,
    MARKET_BASE_URL: `${origin}/__local-dev/unavailable-market`,
    AGENTS_INDEX_URL: `${origin}/__local-dev/unavailable-market`,
    PLUGINS_INDEX_URL: `${origin}/__local-dev/unavailable-market`,
    MEMORY_QUEUE_WORKER_ENABLED: c.MEMORY_ENABLED,
    MEMORY_QUEUE_SCHEDULER_ENABLED: c.MEMORY_ENABLED,
    SEARCH_PROVIDERS: c.SEARCH_ENABLED === '1' ? 'searxng' : '',
    SEARXNG_URL: `http://127.0.0.1:${c.SEARCH_PORT}`,
    FEATURE_FLAGS: `-market,-check_updates,-welcome_suggest,-changelog,-agent_onboarding,-auth_captcha,${c.MEMORY_ENABLED === '1' ? '+' : '-'}memory`,
    DISABLE_APP_UPDATE: '1',
    ENABLE_TELEMETRY: '0',
  };
}
