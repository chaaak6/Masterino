import querystring from 'node:querystring';
import { URL } from 'node:url';

import type { DataSyncConfig } from '@lobechat/electron-client-ipc';
import { safeStorage, session as electronSession } from 'electron';

import { AuthStorage } from '@/modules/authStorage';

import { OFFICIAL_CLOUD_SERVER } from '@/const/env';
import GatewayConnectionService from '@/services/gatewayConnectionSrv';
import { appendVercelCookie } from '@/utils/http-headers';
import { createLogger } from '@/utils/logger';
import { netFetch } from '@/utils/net-fetch';

import { ControllerModule, IpcMethod } from './index';

/**
 * Non-retryable OIDC error codes
 * These errors indicate the refresh token is invalid and retry won't help
 */
const NON_RETRYABLE_OIDC_ERRORS = [
  'invalid_grant', // refresh token is invalid, expired, or revoked
  'invalid_client', // client configuration error
  'unauthorized_client', // client not authorized
  'access_denied', // user denied access
  'invalid_scope', // requested scope is invalid
];

/**
 * Deterministic failures that will never succeed on retry
 * These are permanent state issues that require user intervention
 */
const DETERMINISTIC_FAILURES = [
  'no refresh token available', // refresh token is missing from storage
  'remote server is not active or configured', // config is invalid or disabled
  'missing tokens in refresh response', // server returned incomplete response
];

// Create logger
const logger = createLogger('controllers:RemoteServerConfigCtr');
const TOKEN_REFRESH_TIMEOUT = 30 * 1000;
const TOKEN_REFRESH_TIMEOUT_ERROR = `Token refresh timed out after ${TOKEN_REFRESH_TIMEOUT / 1000} seconds`;

/**
 * Remote Server Configuration Controller
 * Used to manage custom remote Masterino server configuration
 */
export default class RemoteServerConfigCtr extends ControllerModule {
  static override readonly groupName = 'remoteServer';
  /**
   * Key used to store encrypted tokens in electron-store.
   */
  private readonly encryptedTokensKey = 'encryptedTokens';

  private readonly authStorage = new AuthStorage();
  private tokensLoaded = false;

  /**
   * Normalize legacy config that used local storageMode.
   * Local mode has been removed; fall back to cloud.
   */
  private normalizeConfig = (config: DataSyncConfig): DataSyncConfig => {
    if ((config.storageMode as string) !== 'local') return config;

    const nextConfig: DataSyncConfig = {
      ...config,
      remoteServerUrl: OFFICIAL_CLOUD_SERVER,
      storageMode: 'cloud',
    };

    this.app.storeManager.set('dataSyncConfig', nextConfig);

    return nextConfig;
  };

  /**
   * Get remote server configuration
   */
  @IpcMethod()
  async getRemoteServerConfig() {
    logger.debug('Getting remote server configuration');
    const { storeManager } = this.app;

    const config: DataSyncConfig = storeManager.get('dataSyncConfig');
    const normalized = this.normalizeConfig(config);

    logger.debug(
      `Remote server config: active=${normalized.active}, storageMode=${normalized.storageMode}`,
    );

    return normalized.storageMode === 'cloud'
      ? {
          ...normalized,
          remoteServerUrl: normalized.remoteServerUrl?.trim() || OFFICIAL_CLOUD_SERVER,
        }
      : normalized;
  }

  /**
   * Check if remote server is properly configured and ready for use
   * For 'cloud' mode, only checks if active (remoteServerUrl mirrors desktop-config.json)
   * For 'selfHost' mode, checks if active AND remoteServerUrl is configured
   * @param config Optional config object, if not provided will fetch current config
   * @returns true if remote server is properly configured
   */
  async isRemoteServerConfigured(config?: DataSyncConfig): Promise<boolean> {
    const effectiveConfig = config ?? (await this.getRemoteServerConfig());
    return this.isRemoteServerConfigValid(effectiveConfig);
  }

  private isRemoteServerConfigValid(config: DataSyncConfig): boolean {
    const isActive = Boolean(config.active);
    const isSelfHostConfigured =
      config.storageMode !== 'selfHost' || this.isValidSelfHostRemoteUrl(config.remoteServerUrl);

    return isActive && isSelfHostConfigured;
  }

  private isValidSelfHostRemoteUrl(remoteServerUrl?: string): boolean {
    if (!remoteServerUrl) return false;
    const normalizedUrl = remoteServerUrl.trim();

    if (!normalizedUrl) return false;

    try {
      const parsedUrl = new URL(normalizedUrl);
      return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private getRemoteServerOrigin(config: DataSyncConfig): string | null {
    const remoteServerUrl =
      config.storageMode === 'cloud'
        ? config.remoteServerUrl?.trim() || OFFICIAL_CLOUD_SERVER
        : config.remoteServerUrl?.trim();
    if (!remoteServerUrl) return null;

    try {
      return new URL(remoteServerUrl).origin;
    } catch {
      return remoteServerUrl;
    }
  }

  /**
   * Check whether an authorization attempt still targets the configured server.
   * The comparison is origin-only because OIDC issuer tokens must never cross origins.
   */
  isRemoteServerOriginCurrent(remoteServerUrl: string): boolean {
    const currentConfig = this.normalizeConfig(this.app.storeManager.get('dataSyncConfig'));

    try {
      return this.getRemoteServerOrigin(currentConfig) === new URL(remoteServerUrl).origin;
    } catch {
      return false;
    }
  }

  /**
   * Atomically activate the configured server only if it still matches the
   * authorization attempt. There is deliberately no await between reading and
   * writing the config, so another IPC cannot switch origins in that gap.
   */
  activateRemoteServerForOrigin(remoteServerUrl: string): boolean {
    const { storeManager } = this.app;
    const currentConfig = this.normalizeConfig(storeManager.get('dataSyncConfig'));

    let expectedOrigin: string;
    try {
      expectedOrigin = new URL(remoteServerUrl).origin;
    } catch {
      return false;
    }

    if (this.getRemoteServerOrigin(currentConfig) !== expectedOrigin) return false;

    storeManager.set('dataSyncConfig', { ...currentConfig, active: true });
    this.broadcastRemoteServerConfigUpdated();
    return true;
  }

  /**
   * Set remote server configuration
   */
  @IpcMethod()
  async setRemoteServerConfig(config: Partial<DataSyncConfig>) {
    logger.info(
      `Setting remote server storageMode: active=${config.active}, storageMode=${config.storageMode}`,
    );
    const { storeManager } = this.app;
    const prev: DataSyncConfig = storeManager.get('dataSyncConfig');

    // Save configuration with legacy local storage fallback
    const previousConfig = this.normalizeConfig(prev);
    const merged = this.normalizeConfig({ ...previousConfig, ...config });
    const targetChanged =
      this.getRemoteServerOrigin(previousConfig) !== this.getRemoteServerOrigin(merged);
    const isDeactivating = Boolean(previousConfig.active) && !Boolean(merged.active);

    // Tokens are scoped to the server that issued them. Clear them before an
    // origin switch (or explicit deactivation) so a background proxy cannot
    // attach the previous server's token to the pending target.
    if (targetChanged || isDeactivating) await this.clearTokens();

    storeManager.set('dataSyncConfig', merged);

    this.broadcastRemoteServerConfigUpdated();

    return true;
  }

  /**
   * Clear remote server configuration
   */
  @IpcMethod()
  async clearRemoteServerConfig() {
    logger.info('Clearing remote server configuration');
    const { storeManager } = this.app;

    // Clear instance configuration
    storeManager.set('dataSyncConfig', { active: false, storageMode: 'cloud' });

    // Clear tokens (if any)
    await this.clearTokens();

    this.broadcastRemoteServerConfigUpdated();

    return true;
  }

  private broadcastRemoteServerConfigUpdated() {
    logger.debug('Broadcasting remoteServerConfigUpdated event to all windows');
    this.app.browserManager.broadcastToAllWindows('remoteServerConfigUpdated', undefined);
  }

  /**
   * Authentication tokens
   * Stored in memory for quick access, loaded from persistent storage on init.
   */
  private accessToken?: string;
  private refreshToken?: string;

  /**
   * Token expiration time (timestamp in milliseconds)
   * Used for automatic token refresh
   */
  private tokenExpiresAt?: number;

  /**
   * Last token refresh time (timestamp in milliseconds)
   * Used to control refresh frequency on app startup/activate
   */
  private lastRefreshAt?: number;

  /**
   * Promise representing the ongoing token refresh operation.
   * Used to prevent concurrent refreshes and allow callers to wait.
   */
  private refreshPromise: Promise<{ error?: string; success: boolean }> | null = null;
  private refreshPromiseGeneration: number | null = null;
  private tokenGeneration = 0;

  /**
   * Clear all in-memory token state and remove the persisted token record.
   * This synchronous core is also used when secure storage is unavailable,
   * before any legacy value can be loaded or returned.
   */
  private clearTokenStateAndStore() {
    this.tokenGeneration += 1;
    this.accessToken = undefined;
    this.refreshToken = undefined;
    this.tokenExpiresAt = undefined;
    this.lastRefreshAt = undefined;
    this.tokensLoaded = true;
    this.authStorage.clear();
    this.app.storeManager.delete(this.encryptedTokensKey);
  }

  /** Persist before publishing the new state, preserving the previous record on write failure. */
  async saveTokens(accessToken: string, refreshToken: string, expiresIn?: number) {
    const currentConfig = this.normalizeConfig(this.app.storeManager.get('dataSyncConfig'));
    const issuerOrigin = this.getRemoteServerOrigin(currentConfig);
    if (
      !issuerOrigin ||
      (currentConfig.storageMode === 'selfHost' &&
        !this.isValidSelfHostRemoteUrl(currentConfig.remoteServerUrl))
    ) {
      throw new Error('Cannot save OIDC tokens without a valid remote server origin');
    }
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;
    const lastRefreshAt = Date.now();
    this.authStorage.write({ accessToken, refreshToken, expiresAt, issuerOrigin, lastRefreshAt });
    this.tokenGeneration += 1;
    this.tokensLoaded = true;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenExpiresAt = expiresAt;
    this.lastRefreshAt = lastRefreshAt;
    this.app.storeManager.delete(this.encryptedTokensKey);
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.tokensLoaded) this.loadTokensFromStore();
    return this.accessToken ?? null;
  }

  async getRefreshToken(): Promise<string | null> {
    if (!this.tokensLoaded) this.loadTokensFromStore();
    return this.refreshToken ?? null;
  }

  /**
   * Clear tokens
   */
  async clearTokens() {
    logger.info('Clearing access and refresh tokens');
    this.clearTokenStateAndStore();

    // Disconnect gateway when tokens are cleared (logout / token refresh failure)
    const gatewaySrv = this.app.getService(GatewayConnectionService);
    if (gatewaySrv) {
      logger.debug('Disconnecting gateway due to token clear');
      await gatewaySrv.disconnect();
    }
  }

  /**
   * Get token expiration time
   */
  getTokenExpiresAt(): number | undefined {
    return this.tokenExpiresAt;
  }

  /**
   * Check if token is expired or will expire soon
   * @param bufferTimeMs Buffer time in milliseconds (default 1 day)
   * @returns true if token is expired or will expire soon
   */
  isTokenExpiringSoon(bufferTimeMs: number = 24 * 60 * 60 * 1000): boolean {
    if (!this.tokenExpiresAt) {
      return false; // No expiration time available
    }

    const currentTime = Date.now();
    const bufferTime = this.tokenExpiresAt - bufferTimeMs;

    return currentTime >= bufferTime;
  }

  /**
   * Check if an error is non-retryable
   * Includes OIDC errors (e.g., invalid_grant) and deterministic failures
   * (e.g., missing refresh token, invalid config)
   * @param error Error message to check
   * @returns true if the error should not be retried
   */
  isNonRetryableError(error?: string): boolean {
    if (!error) return false;
    const lowerError = error.toLowerCase();

    // Check OIDC error codes
    if (NON_RETRYABLE_OIDC_ERRORS.some((code) => lowerError.includes(code))) {
      return true;
    }

    // Check deterministic failures that require user intervention
    if (DETERMINISTIC_FAILURES.some((msg) => lowerError.includes(msg))) {
      return true;
    }

    return false;
  }

  /**
   * Refresh the access token using the stored refresh token (single attempt).
   * Concurrent callers share the in-progress refresh promise.
   */
  async refreshAccessToken(): Promise<{ error?: string; success: boolean }> {
    const refreshGeneration = this.tokenGeneration;

    // Concurrent refreshes for the same credential generation share one request.
    // A server/token switch advances the generation and must not reuse the old request.
    if (this.refreshPromise && this.refreshPromiseGeneration === refreshGeneration) {
      logger.debug('Token refresh already in progress, returning existing promise.');
      return this.refreshPromise;
    }

    logger.info('Initiating new token refresh operation.');

    // No retry: with refresh token rotation the server consumes the old token as soon
    // as the request lands. Resending it (e.g. after a lost response) triggers reuse
    // detection — invalid_grant + revocation of the whole grant — which logs the user
    // out. Transient failures are recovered by the next refresh cycle instead.
    const refreshPromise = this.performTokenRefresh(refreshGeneration).finally(() => {
      if (this.refreshPromise !== refreshPromise) return;

      logger.debug('Clearing the refresh promise reference.');
      this.refreshPromise = null;
      this.refreshPromiseGeneration = null;
    });
    this.refreshPromise = refreshPromise;
    this.refreshPromiseGeneration = refreshGeneration;

    return this.refreshPromise;
  }

  /**
   * Performs the actual token refresh logic.
   * This method is called by refreshAccessToken and wrapped in a promise.
   */
  private isTokenRefreshCurrent(expectedGeneration: number, expectedOrigin: string): boolean {
    if (this.tokenGeneration !== expectedGeneration) return false;

    const currentConfig = this.normalizeConfig(this.app.storeManager.get('dataSyncConfig'));
    return (
      this.isRemoteServerConfigValid(currentConfig) &&
      this.getRemoteServerOrigin(currentConfig) === expectedOrigin
    );
  }

  private waitForTokenRefreshOperation<T>(
    operation: Promise<T>,
    deadline: number,
    abortController: AbortController,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(
        () => {
          if (settled) return;
          settled = true;
          abortController.abort();
          reject(new Error(TOKEN_REFRESH_TIMEOUT_ERROR));
        },
        Math.max(1, deadline - Date.now()),
      );

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        callback();
      };

      operation.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }

  private async performTokenRefresh(
    expectedGeneration: number,
  ): Promise<{ error?: string; success: boolean }> {
    const abortController = new AbortController();
    const deadline = Date.now() + TOKEN_REFRESH_TIMEOUT;

    try {
      // Get configuration information
      const config = await this.getRemoteServerConfig();

      if (!(await this.isRemoteServerConfigured(config))) {
        logger.warn('Remote server not active or configured, skipping refresh.');
        return { error: 'Remote server is not active or configured', success: false };
      }

      const expectedOrigin = this.getRemoteServerOrigin(config);
      if (!expectedOrigin || !this.isTokenRefreshCurrent(expectedGeneration, expectedOrigin)) {
        return {
          error: 'Token refresh was superseded by a server or credential change',
          success: false,
        };
      }

      // Get refresh token
      const refreshToken = await this.getRefreshToken();
      if (!refreshToken) {
        logger.error('No refresh token available for refresh operation.');
        return { error: 'No refresh token available', success: false };
      }

      if (!this.isTokenRefreshCurrent(expectedGeneration, expectedOrigin)) {
        return {
          error: 'Token refresh was superseded by a server or credential change',
          success: false,
        };
      }

      // Construct refresh request
      const remoteUrl = await this.getRemoteServerUrl(config);

      const tokenUrl = new URL('/oidc/token', remoteUrl);

      // Construct request body
      const body = querystring.stringify({
        client_id: 'lobehub-desktop',
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      logger.debug(`Sending token refresh request to ${tokenUrl.toString()}`);

      // Send request
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      appendVercelCookie(headers);
      const response = await this.waitForTokenRefreshOperation(
        netFetch(tokenUrl.toString(), {
          body,
          headers,
          method: 'POST',
          signal: abortController.signal,
        }),
        deadline,
        abortController,
      );

      if (!this.isTokenRefreshCurrent(expectedGeneration, expectedOrigin)) {
        return {
          error: 'Token refresh was superseded by a server or credential change',
          success: false,
        };
      }

      if (!response.ok) {
        // Try to parse error response
        let errorData: Record<string, unknown> = {};
        try {
          errorData = await this.waitForTokenRefreshOperation(
            response.json(),
            deadline,
            abortController,
          );
        } catch (error) {
          if (error instanceof Error && error.message === TOKEN_REFRESH_TIMEOUT_ERROR) throw error;
        }
        if (!this.isTokenRefreshCurrent(expectedGeneration, expectedOrigin)) {
          return {
            error: 'Token refresh was superseded by a server or credential change',
            success: false,
          };
        }
        const errorDetail =
          typeof errorData.error_description === 'string'
            ? errorData.error_description
            : typeof errorData.error === 'string'
              ? errorData.error
              : '';
        const errorMessage =
          `Token refresh failed: ${response.status} ${response.statusText} ${errorDetail}`.trim();
        logger.error(errorMessage);
        return { error: errorMessage, success: false };
      }

      // Parse response
      const data = await this.waitForTokenRefreshOperation(
        response.json(),
        deadline,
        abortController,
      );
      if (!this.isTokenRefreshCurrent(expectedGeneration, expectedOrigin)) {
        return {
          error: 'Token refresh was superseded by a server or credential change',
          success: false,
        };
      }

      // Check if response contains necessary tokens
      if (!data.access_token || !data.refresh_token) {
        logger.error('Refresh response missing access_token or refresh_token', {
          hasAccessToken: Boolean(data.access_token),
          hasRefreshToken: Boolean(data.refresh_token),
        });
        return { error: 'Missing tokens in refresh response', success: false };
      }

      // The response may arrive after the user switched servers or completed a
      // different login. Verify again immediately before the synchronous token write.
      if (!this.isTokenRefreshCurrent(expectedGeneration, expectedOrigin)) {
        return {
          error: 'Token refresh was superseded by a server or credential change',
          success: false,
        };
      }

      // Save new tokens
      logger.info('Token refresh successful, saving new tokens.');
      await this.saveTokens(data.access_token, data.refresh_token, data.expires_in);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Exception during token refresh operation:', errorMessage, error);
      return { error: `Exception occurred during token refresh: ${errorMessage}`, success: false };
    } finally {
      abortController.abort();
    }
  }

  /**
   * Load plaintext auth.json, or migrate the legacy Windows record.
   * This should be called during initialization or if memory tokens are missing.
   */
  private loadTokensFromStore() {
    if (this.tokensLoaded) return;
    this.tokensLoaded = true;
    const config = this.normalizeConfig(this.app.storeManager.get('dataSyncConfig'));
    const origin = this.getRemoteServerOrigin(config);
    try {
      let tokens = this.authStorage.read();
      // Windows DPAPI migration is non-interactive. Never touch the old macOS
      // Keychain: those users authorize once if no plaintext record exists yet.
      const legacy = this.app.storeManager.get(this.encryptedTokensKey);
      if (
        !tokens &&
        process.platform === 'win32' &&
        origin &&
        legacy?.issuerOrigin === origin &&
        legacy.accessToken &&
        legacy.refreshToken &&
        safeStorage.isEncryptionAvailable()
      ) {
        tokens = {
          ...legacy,
          issuerOrigin: origin,
          accessToken: safeStorage.decryptString(Buffer.from(legacy.accessToken, 'base64')),
          refreshToken: safeStorage.decryptString(Buffer.from(legacy.refreshToken, 'base64')),
        };
        this.authStorage.write(tokens);
        this.app.storeManager.delete(this.encryptedTokensKey);
      }
      if (!tokens || !origin || tokens.issuerOrigin !== origin) return;
      this.tokenGeneration += 1;
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      this.tokenExpiresAt = tokens.expiresAt;
      this.lastRefreshAt = tokens.lastRefreshAt;
    } catch {
      // Do not print credential values or erase a potentially recoverable record.
      logger.warn('Could not load desktop credentials; authorization may be required');
    }
  }

  /**
   * Get the last token refresh time
   * @returns The timestamp (in milliseconds) of the last token refresh, or undefined if never refreshed
   */
  getLastTokenRefreshAt(): number | undefined {
    return this.lastRefreshAt;
  }

  // Initialize by loading tokens from store when the controller is ready
  // We might need a dedicated lifecycle method if constructor is too early for storeManager
  afterAppReady() {
    this.loadTokensFromStore();
  }

  async getRemoteServerUrl(config?: DataSyncConfig) {
    const dataConfig = this.normalizeConfig(config ?? (await this.getRemoteServerConfig()));

    return dataConfig.storageMode === 'cloud'
      ? dataConfig.remoteServerUrl?.trim() || OFFICIAL_CLOUD_SERVER
      : dataConfig.remoteServerUrl;
  }

  /**
   * Setup subscription webview session with OIDC token injection
   * This configures a webRequest interceptor on the given partition session
   * to automatically inject the Oidc-Auth token header for official domain requests.
   * @param params.partition The partition name for the webview session
   */
  @IpcMethod()
  async setupSubscriptionWebviewSession(params: { partition: string }) {
    const { partition } = params;

    logger.info(`Setting up subscription webview session for partition: ${partition}`);

    const session = electronSession.fromPartition(partition);

    session.webRequest.onBeforeSendHeaders(
      { urls: ['http://*/*', 'https://*/*'] },
      async (details, callback) => {
        const requestHeaders = { ...details.requestHeaders };

        // Never preserve a renderer-provided auth header. Authentication is
        // added back only after validating the current active server origin.
        for (const headerName of Object.keys(requestHeaders)) {
          if (headerName.toLowerCase() === 'oidc-auth') delete requestHeaders[headerName];
        }

        try {
          const requestOrigin = new URL(details.url).origin;
          const initialConfig = this.normalizeConfig(this.app.storeManager.get('dataSyncConfig'));

          if (
            !this.isRemoteServerConfigValid(initialConfig) ||
            this.getRemoteServerOrigin(initialConfig) !== requestOrigin
          ) {
            callback({ requestHeaders });
            return;
          }

          const token = await this.getAccessToken();
          if (!token) {
            callback({ requestHeaders });
            return;
          }

          // Re-read after token decryption so a concurrent origin switch fails closed.
          const currentConfig = this.normalizeConfig(this.app.storeManager.get('dataSyncConfig'));
          if (
            !this.isRemoteServerConfigValid(currentConfig) ||
            this.getRemoteServerOrigin(currentConfig) !== requestOrigin
          ) {
            callback({ requestHeaders });
            return;
          }

          requestHeaders['Oidc-Auth'] = token;
          logger.debug(`Injected Oidc-Auth token for ${requestOrigin}`);
        } catch (error) {
          logger.warn('Skipping subscription webview auth injection:', error);
        }

        callback({ requestHeaders });
      },
    );

    logger.debug(`Subscription webview session setup completed for partition: ${partition}`);

    return { success: true };
  }
}
