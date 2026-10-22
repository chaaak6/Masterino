import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveCliManagedPaths } from '../utils/managedPaths';

export interface StoredCredentials {
  accessToken: string;
  expiresAt?: number; // Unix timestamp (seconds)
  refreshToken?: string;
}

const getCredentialPaths = () => {
  const { legacyStateRoot, stateRoot } = resolveCliManagedPaths();
  return {
    canonical: path.join(stateRoot, 'credentials.json'),
    legacy: path.join(legacyStateRoot, 'credentials.json'),
    stateRoot,
  };
};

// Derive an encryption key from machine-specific info
// Not bulletproof, but prevents casual reading of the credentials file
function deriveKey(): Buffer {
  const material = `lobehub-cli:${os.hostname()}:${os.userInfo().username}`;
  return crypto.pbkdf2Sync(material, 'lobehub-cli-salt', 100_000, 32, 'sha256');
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Pack: iv(12) + authTag(16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

function decrypt(encoded: string): string {
  const key = deriveKey();
  const packed = Buffer.from(encoded, 'base64');
  const iv = packed.subarray(0, 12);
  const authTag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

export function saveCredentials(credentials: StoredCredentials): void {
  const { canonical, stateRoot } = getCredentialPaths();
  fs.mkdirSync(stateRoot, { mode: 0o700, recursive: true });
  const encrypted = encrypt(JSON.stringify(credentials));
  fs.writeFileSync(canonical, encrypted, { mode: 0o600 });
}

export function loadCredentials(): StoredCredentials | null {
  const { canonical, legacy } = getCredentialPaths();
  for (const filename of [canonical, legacy]) {
    try {
      const data = fs.readFileSync(filename, 'utf8');

      let credentials: StoredCredentials;
      try {
        credentials = JSON.parse(decrypt(data)) as StoredCredentials;
      } catch {
        credentials = JSON.parse(data) as StoredCredentials;
      }
      if (filename !== canonical) saveCredentials(credentials);
      else if (data.trimStart().startsWith('{')) saveCredentials(credentials);
      return credentials;
    } catch {
      // Try the compatibility location before reporting no credentials.
    }
  }
  return null;
}

export function clearCredentials(): boolean {
  let removed = false;
  const { canonical, legacy } = getCredentialPaths();
  for (const filename of new Set([canonical, legacy])) {
    try {
      fs.unlinkSync(filename);
      removed = true;
    } catch {
      // Already absent.
    }
  }
  return removed;
}
