import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from '@playwright/test';

import { buildProductionLifecycle } from './buildProductionLifecycle.mjs';

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(supportDirectory, '..');
const repositoryRoot = path.resolve(electronRoot, '../..');

const createTestJwks = () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    keys: [
      {
        ...privateKey.export({ format: 'jwk' }),
        alg: 'RS256',
        kid: 'masterino-electron-e2e',
        use: 'sig',
      },
    ],
  });
};

const resolveElectronExecutable = () => {
  if (process.env.ELECTRON_EXECUTABLE_PATH) return process.env.ELECTRON_EXECUTABLE_PATH;

  try {
    const desktopRequire = createRequire(path.resolve(repositoryRoot, 'apps/desktop/package.json'));
    return desktopRequire('electron');
  } catch {
    // A graph worktree intentionally reuses the primary checkout's already-installed desktop
    // runtime. Resolve it through git's common directory without assuming a sibling name.
    const commonDirectory = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
      },
    ).trim();
    const primaryCheckout = path.dirname(commonDirectory);
    const primaryDesktopRequire = createRequire(
      path.resolve(primaryCheckout, 'apps/desktop/package.json'),
    );
    return primaryDesktopRequire('electron');
  }
};

export const launchElectronTestApp = async (options = {}) => {
  if (!options.skipBuild) await buildProductionLifecycle();

  return electron.launch({
    args: [path.resolve(electronRoot, 'app/main.cjs')],
    env: {
      ...process.env,
      ...options.env,
      // The bundled production graph still evaluates a legacy database barrel.
      // Give that unused client an unreachable address; every acceptance query
      // is explicitly issued through the isolated PGlite instance instead.
      DATABASE_URL: 'postgresql://masterino:masterino@127.0.0.1:1/masterino_e2e_unreachable',
      // AiAgentService signs the same operation-scoped token used by real
      // heterogeneous device runs. A per-launch key keeps this lane isolated
      // while exercising production JOSE signing instead of replacing it.
      JWKS_KEY: createTestJwks(),
      KEY_VAULTS_SECRET: randomBytes(32).toString('base64'),
      MASTERINO_ELECTRON_E2E: '1',
      NODE_ENV: 'production',
      // The workspace-runtime lane must never inherit an opt-in to the shared
      // PostgreSQL test server from the parent shell.
      TEST_SERVER_DB: '0',
    },
    executablePath: resolveElectronExecutable(),
  });
};
