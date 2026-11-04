import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const testHome = path.join(os.tmpdir(), 'masterino-cli-managed-paths');

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return { ...actual, default: { ...actual.default, homedir: () => testHome } };
});

// eslint-disable-next-line import-x/first
import { resolveCliManagedPaths } from './managedPaths';

describe('resolveCliManagedPaths', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses ~/.masterino for a new CLI installation', () => {
    vi.stubEnv('MASTERINO_HOME', '');
    vi.stubEnv('LOBEHUB_CLI_HOME', '');

    expect(resolveCliManagedPaths().home).toBe(path.join(testHome, '.masterino'));
  });

  it('keeps an explicitly isolated legacy CLI home working', () => {
    vi.stubEnv('MASTERINO_HOME', '');
    vi.stubEnv('LOBEHUB_CLI_HOME', '.lobehub-dev');

    expect(resolveCliManagedPaths().home).toBe(path.join(testHome, '.lobehub-dev'));
  });

  it('gives MASTERINO_HOME precedence over the legacy CLI-only override', () => {
    const configured = path.join(testHome, 'configured-masterino');
    vi.stubEnv('MASTERINO_HOME', configured);
    vi.stubEnv('LOBEHUB_CLI_HOME', '.lobehub-dev');

    expect(resolveCliManagedPaths().home).toBe(configured);
  });
});
