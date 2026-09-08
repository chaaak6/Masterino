import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { localEnvironment, root, systemEnvironment, validateConfig } from './config.mjs';
import { createGrantStore, validLocalRequest, localReturnPath } from './proxy.mjs';
import { assertLocalDockerEndpoint } from './infrastructure.mjs';

describe('isolated development configuration', () => {
  it('rejects remote Docker daemons before creating services or migrating', () => {
    expect(() => assertLocalDockerEndpoint('unix:///var/run/docker.sock')).not.toThrow();
    expect(() => assertLocalDockerEndpoint('ssh://production')).toThrow('remote');
    expect(() => assertLocalDockerEndpoint('tcp://127.0.0.1:2375')).toThrow('remote');
  });
  it('rejects arbitrary database targets and duplicate or invalid ports', () => {
    expect(() => validateConfig({ DATABASE_URL: 'postgres://test-server/db' })).toThrow('Unknown');
    expect(() => validateConfig({ WEB_PORT: '3011' })).toThrow('distinct');
    expect(() => validateConfig({ WEB_PORT: '80' })).toThrow('Invalid');
    expect(() => validateConfig({ AIHUB_BASE_URL: 'https://secret@example.com/v1' })).toThrow(
      'credentials',
    );
  });
  it('does not inherit shell credentials, node preloads or deployment selectors', () => {
    expect(
      systemEnvironment({
        PATH: '/bin',
        HOME: '/home/dev',
        DATABASE_URL: 'remote',
        NODE_OPTIONS: '--require /unsafe',
        AUTH_SECRET: 'production',
        ACK_CONTEXT: 'production',
      }),
    ).toEqual({ PATH: '/bin', HOME: '/home/dev' });
  });
  it('derives all local infrastructure addresses from the same instance', () => {
    const env = localEnvironment({
      c: validateConfig({}),
      origin: 'http://localhost:3010',
      project: 'masterino-local-abc',
      instance: {
        id: 'abc',
        password: 'local',
        authSecret: 'a',
        vaultSecret: 'b',
        gatewayToken: 'c',
        jwks: '{}',
        publicJwks: '{}',
      },
    });
    expect(env.DATABASE_URL).toBe('postgresql://postgres:local@127.0.0.1:15432/masterino_local');
    expect(env.DEVICE_GATEWAY_URL).toBe('http://localhost:8788');
    expect(env.QSTASH_URL).toBe('http://127.0.0.1:18080');
    expect(env.UPSTASH_WORKFLOW_URL).toBe(env.INTERNAL_APP_URL);
    expect(env.AUTH_TRUSTED_ORIGINS).toBe(env.APP_URL);
    expect(env.ENABLE_MOCK_DEV_USER).toBeUndefined();
    expect(env.FEATURE_FLAGS).toContain('-market');
  });
  it('Next environment adapter ignores external .env files even on forced watcher reload', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'masterino-env-isolation-'));
    writeFileSync(
      path.join(directory, '.env.development.local'),
      'MASTERINO_ENV_LEAK=remote-secret\n',
    );
    try {
      const script = `const p=require.resolve('@next/env',{paths:[require.resolve('next')]});require(p).loadEnvConfig(${JSON.stringify(directory)},true,console,true);if(process.env.MASTERINO_ENV_LEAK)process.exit(7);require('node:dns').lookup('host.docker.internal',(error,address)=>{if(error||address!=='127.0.0.1')process.exit(8)});`;
      const result = spawnSync(
        process.execPath,
        ['--require', './scripts/local-dev/next-env.cjs', '-e', script],
        {
          cwd: root,
          env: { ...systemEnvironment(), NODE_ENV: 'development', MASTERINO_DEV_ENV: 'local' },
          encoding: 'utf8',
        },
      );
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('Next adapter refuses production use even when a local flag is set', () => {
    const result = spawnSync(
      process.execPath,
      ['--require', './scripts/local-dev/next-env.cjs', '-e', ''],
      {
        cwd: root,
        env: { ...systemEnvironment(), NODE_ENV: 'production', MASTERINO_DEV_ENV: 'local' },
        encoding: 'utf8',
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('development-only');
  });
});
describe('local login boundary', () => {
  it('keeps OIDC callbacks local and rejects open redirects and login loops', () => {
    const origin = 'http://localhost:3010';
    expect(localReturnPath(`${origin}/oidc/auth?state=a`, origin)).toBe('/oidc/auth?state=a');
    for (const url of [
      'https://mlai-test.bielcrystal.com/',
      '//evil.example/',
      'javascript:alert(1)',
      '/signin',
      '/__local-dev',
    ])
      expect(localReturnPath(url, origin)).toBe('/');
  });
  it('requires exact Host and Origin, rejecting remote origins and DNS rebinding hosts', () => {
    expect(
      validLocalRequest('localhost:3010', 'http://localhost:3010', 'http://localhost:3010'),
    ).toBe(true);
    expect(
      validLocalRequest('localhost:3010', 'https://remote.example', 'http://localhost:3010'),
    ).toBe(false);
    expect(validLocalRequest('evil.example:3010', undefined, 'http://localhost:3010')).toBe(false);
  });
  it('consumes each unpredictable login grant exactly once', () => {
    const grants = createGrantStore();
    const a = grants.issue(),
      b = grants.issue();
    expect(a).not.toBe(b);
    expect(grants.consume('invalid')).toBe(false);
    expect(grants.consume(a)).toBe(true);
    expect(grants.consume(a)).toBe(false);
    expect(grants.consume(b)).toBe(true);
  });
});
