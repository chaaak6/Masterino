import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

export interface StoredAuth {
  accessToken: string;
  expiresAt?: number;
  issuerOrigin: string;
  lastRefreshAt?: number;
  refreshToken: string;
}

/** Company-managed desktop credentials. Deliberately plaintext, never part of settings exports. */
export class AuthStorage {
  constructor(private readonly file = path.join(app.getPath('userData'), 'auth.json')) {}

  read(): StoredAuth | undefined {
    if (!existsSync(this.file)) return;
    const data = JSON.parse(readFileSync(this.file, 'utf8'));
    if (
      data.version !== 1 ||
      typeof data.accessToken !== 'string' ||
      !data.accessToken ||
      typeof data.refreshToken !== 'string' ||
      !data.refreshToken ||
      typeof data.issuerOrigin !== 'string' ||
      !data.issuerOrigin ||
      (data.expiresAt !== undefined && !Number.isFinite(data.expiresAt)) ||
      (data.lastRefreshAt !== undefined && !Number.isFinite(data.lastRefreshAt))
    ) {
      throw new Error('Invalid auth.json credential record');
    }
    return data;
  }

  write(tokens: StoredAuth) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ ...tokens, version: 1 }), {
        flag: 'wx',
        mode: 0o600,
      });
      renameSync(temporary, this.file);
      if (process.platform !== 'win32') chmodSync(this.file, 0o600);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  clear() {
    rmSync(this.file, { force: true });
  }
}
