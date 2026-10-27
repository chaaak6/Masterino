import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { AuthStorage } from './authStorage';

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true })),
);
it('persists plaintext credentials in a versioned private file across instances and clears on logout', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'masterino-auth-'));
  directories.push(dir);
  const file = path.join(dir, 'auth.json');
  const tokens = {
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
    issuerOrigin: 'https://test.example',
  };
  new AuthStorage(file).write(tokens);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...tokens, version: 1 });
  expect(new AuthStorage(file).read()).toMatchObject(tokens);
  if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  new AuthStorage(file).clear();
  expect(new AuthStorage(file).read()).toBeUndefined();
});
it('rejects invalid records without deleting them', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'masterino-auth-'));
  directories.push(dir);
  const file = path.join(dir, 'auth.json');
  writeFileSync(file, '{invalid');
  expect(() => new AuthStorage(file).read()).toThrow();
  expect(readFileSync(file, 'utf8')).toBe('{invalid');
});
