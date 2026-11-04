import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { OFFICIAL_AGENT_GATEWAY_URL, OFFICIAL_SERVER_URL } from '../constants/urls';
import { log } from '../utils/logger';
import { resolveCliManagedPaths } from '../utils/managedPaths';

export interface StoredSettings {
  agentGatewayUrl?: string;
  gatewayUrl?: string;
  serverUrl?: string;
}

const getSettingsPaths = () => {
  const { legacyStateRoot, stateRoot } = resolveCliManagedPaths();
  return {
    connectionId: path.join(stateRoot, 'connection-id'),
    legacyConnectionId: path.join(legacyStateRoot, 'connection-id'),
    legacySettings: path.join(legacyStateRoot, 'settings.json'),
    settings: path.join(stateRoot, 'settings.json'),
    stateRoot,
  };
};

export function normalizeUrl(url: string | undefined): string | undefined {
  return url ? url.replace(/\/$/, '') : undefined;
}

export function resolveServerUrl(): string {
  const envServerUrl = normalizeUrl(process.env.LOBEHUB_SERVER);
  const settingsServerUrl = normalizeUrl(loadSettings()?.serverUrl);

  return envServerUrl || settingsServerUrl || OFFICIAL_SERVER_URL;
}

export function resolveAgentGatewayUrl(): string | undefined {
  const envUrl = normalizeUrl(process.env.AGENT_GATEWAY_URL);
  const settingsUrl = normalizeUrl(loadSettings()?.agentGatewayUrl);

  return envUrl || settingsUrl || OFFICIAL_AGENT_GATEWAY_URL;
}

export function saveSettings(settings: StoredSettings): void {
  const paths = getSettingsPaths();
  const agentGatewayUrl = normalizeUrl(settings.agentGatewayUrl);
  const gatewayUrl = normalizeUrl(settings.gatewayUrl);
  const serverUrl = normalizeUrl(settings.serverUrl);
  const normalized: StoredSettings = {
    agentGatewayUrl: agentGatewayUrl === OFFICIAL_AGENT_GATEWAY_URL ? undefined : agentGatewayUrl,
    gatewayUrl,
    serverUrl: serverUrl === OFFICIAL_SERVER_URL ? undefined : serverUrl,
  };

  if (!normalized.serverUrl && !normalized.gatewayUrl && !normalized.agentGatewayUrl) {
    for (const filename of new Set([paths.settings, paths.legacySettings]))
      try {
        fs.unlinkSync(filename);
      } catch {}
    return;
  }

  fs.mkdirSync(paths.stateRoot, { mode: 0o700, recursive: true });
  fs.writeFileSync(paths.settings, JSON.stringify(normalized, null, 2), { mode: 0o600 });
}

/**
 * Stable per-install connection routing key for `lh connect`. Decoupled from
 * the (machine-derived, shared-across-clients) deviceId so the gateway only
 * replaces this install's own stale socket — a co-running desktop app on the
 * same machine keeps its connection. Persisted under MASTERINO_HOME/state;
 * the legacy CLI-home override remains an isolation fallback for dev builds.
 */
export function loadOrCreateConnectionId(): string {
  const paths = getSettingsPaths();
  for (const filename of [paths.connectionId, paths.legacyConnectionId]) {
    try {
      const existing = fs.readFileSync(filename, 'utf8').trim();
      if (existing) {
        if (filename !== paths.connectionId) {
          fs.mkdirSync(paths.stateRoot, { mode: 0o700, recursive: true });
          fs.writeFileSync(paths.connectionId, existing, { mode: 0o600 });
        }
        return existing;
      }
    } catch {
      // Try the compatibility location before creating a new id.
    }
  }

  const id = randomUUID();
  try {
    fs.mkdirSync(paths.stateRoot, { mode: 0o700, recursive: true });
    fs.writeFileSync(paths.connectionId, id, { mode: 0o600 });
  } catch {
    // best-effort: an unwritable home dir just means a fresh id per run
  }
  return id;
}

export function loadSettings(): StoredSettings | null {
  const paths = getSettingsPaths();
  const filename = [paths.settings, paths.legacySettings].find((candidate) =>
    fs.existsSync(candidate),
  );
  if (!filename) return null;

  try {
    const data = fs.readFileSync(filename, 'utf8');
    const parsed = JSON.parse(data) as StoredSettings;
    const agentGatewayUrl = normalizeUrl(parsed.agentGatewayUrl);
    const gatewayUrl = normalizeUrl(parsed.gatewayUrl);
    const serverUrl = normalizeUrl(parsed.serverUrl);
    const normalized: StoredSettings = {
      agentGatewayUrl: agentGatewayUrl === OFFICIAL_AGENT_GATEWAY_URL ? undefined : agentGatewayUrl,
      gatewayUrl,
      serverUrl: serverUrl === OFFICIAL_SERVER_URL ? undefined : serverUrl,
    };

    if (!normalized.serverUrl && !normalized.gatewayUrl && !normalized.agentGatewayUrl) return null;

    return normalized;
  } catch {
    log.warn(
      `Could not parse ${filename}. Please delete this file and run 'lh login' again if needed.`,
    );
    return null;
  }
}
