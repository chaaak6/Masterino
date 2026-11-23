import crypto from 'node:crypto';
import querystring from 'node:querystring';
import { URL } from 'node:url';

import type {
  AuthorizationProgress,
  DataSyncConfig,
  MarketAuthorizationParams,
} from '@lobechat/electron-client-ipc';
import { BrowserWindow, shell } from 'electron';

import GatewayConnectionService from '@/services/gatewayConnectionSrv';
import { appendVercelCookie } from '@/utils/http-headers';
import { createLogger } from '@/utils/logger';
import { netFetch } from '@/utils/net-fetch';
import { getProtocolScheme } from '@/utils/protocol';

import { ControllerModule, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

const logger = createLogger('controllers:AuthCtr');

const MAX_POLL_TIME = 5 * 60 * 1000; // 5 minutes, aligned with the server handoff TTL
const POLL_INTERVAL = 3000; // 3 seconds
const REMOTE_CONFIG_TIMEOUT = 10 * 1000; // 10 seconds
const HANDOFF_REQUEST_TIMEOUT = 15 * 1000; // 15 seconds per polling request
const TOKEN_EXCHANGE_TIMEOUT = 30 * 1000; // 30 seconds for the complete token exchange

type AuthorizationAttempt = {
  abortController: AbortController;
  codeVerifier: string;
  id: number;
  remoteUrl: string;
  state: string;
};

type TokenExchangeResult = {
  error?: string;
  success: boolean;
  superseded?: boolean;
};

type AuthorizationCommitBarrierResult = {
  rollbackError?: string;
};

class AuthorizationSupersededError extends Error {
  constructor() {
    super('Authorization request was cancelled or superseded');
    this.name = 'AuthorizationSupersededError';
  }
}

class HandoffPollingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'HandoffPollingError';
  }
}

class AuthorizationRollbackError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthorizationRollbackError';
  }
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const formatHttpResponseError = (response: Response, rawBody = ''): string => {
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const trimmedBody = rawBody.trim();
  if (!trimmedBody) return status;

  let detail = trimmedBody;
  try {
    const body = JSON.parse(trimmedBody) as Record<string, unknown>;
    const structuredDetail = body.error_description ?? body.error ?? body.message;
    if (typeof structuredDetail === 'string' && structuredDetail.trim()) {
      detail = structuredDetail.trim();
    }
  } catch {
    // Keep a plain-text response as the server-provided error detail.
  }

  // Avoid surfacing an entire proxy HTML error page while retaining its useful reason.
  return `${status}: ${detail.slice(0, 500)}`;
};

// Refresh the access token only once it is within this window of its expiry. Kept
// small (minutes) on purpose: a buffer that is large relative to the server's
// access-token lifetime makes the token look "expiring soon" right after login,
// refreshing on every launch/activation and churning refresh-token rotations.
const TOKEN_REFRESH_BUFFER = 10 * 60 * 1000; // 10 minutes

/**
 * Authentication Controller
 * Implements OAuth authorization flow using intermediate page + polling mechanism
 */
export default class AuthCtr extends ControllerModule {
  static override readonly groupName = 'auth';
  /**
   * Remote server configuration controller
   */
  private get remoteServerConfigCtr() {
    return this.app.getController(RemoteServerConfigCtr);
  }

  private authRequestState: string | null = null;
  private authorizationAbortController: AbortController | null = null;
  private authorizationAttemptId = 0;
  private authorizationCommitPromise: Promise<AuthorizationCommitBarrierResult> | null = null;
  private authorizationInProgress = false;

  /**
   * Polling related parameters
   */

  private pollingInterval: NodeJS.Timeout | null = null;

  /**
   * Auto-refresh timer
   */

  private autoRefreshTimer: NodeJS.Timeout | null = null;

  /**
   * Construct redirect_uri, ensuring the same URI is used for authorization and token exchange
   * @param remoteUrl Remote server URL
   */
  private constructRedirectUri(remoteUrl: string): string {
    const callbackUrl = new URL('/oidc/callback/desktop', remoteUrl);

    return callbackUrl.toString();
  }

  private isAuthorizationAttemptCurrent(attemptId: number): boolean {
    return this.authorizationInProgress && this.authorizationAttemptId === attemptId;
  }

  private isAuthorizationAttemptActive(attempt: AuthorizationAttempt): boolean {
    return (
      this.isAuthorizationAttemptCurrent(attempt.id) &&
      this.authorizationAbortController === attempt.abortController &&
      !attempt.abortController.signal.aborted &&
      this.authRequestState === attempt.state
    );
  }

  private ensureAuthorizationAttemptCurrent(
    attemptId: number,
    abortController: AbortController,
  ): void {
    if (
      !this.isAuthorizationAttemptCurrent(attemptId) ||
      this.authorizationAbortController !== abortController ||
      abortController.signal.aborted
    ) {
      throw new AuthorizationSupersededError();
    }
  }

  /**
   * Tie an asynchronous operation to one authorization generation. This also
   * makes cancellation effective when a mocked or platform fetch ignores the
   * AbortSignal itself.
   */
  private waitForAuthorizationOperation<T>(
    operation: Promise<T>,
    attemptId: number,
    abortController: AbortController,
    timeout?: {
      abortController?: AbortController;
      message: string;
      milliseconds: number;
    },
  ): Promise<T> {
    if (
      !this.isAuthorizationAttemptCurrent(attemptId) ||
      this.authorizationAbortController !== abortController ||
      abortController.signal.aborted
    ) {
      return Promise.reject(new AuthorizationSupersededError());
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timeoutId: NodeJS.Timeout | undefined;

      const cleanup = () => {
        abortController.signal.removeEventListener('abort', handleAbort);
        if (timeoutId) clearTimeout(timeoutId);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const handleAbort = () => finish(() => reject(new AuthorizationSupersededError()));

      abortController.signal.addEventListener('abort', handleAbort, { once: true });
      if (timeout) {
        timeoutId = setTimeout(() => {
          finish(() => reject(new Error(timeout.message)));
          // Abort only the scoped network operation when one was provided. A
          // retryable handoff timeout must not cancel the whole authorization
          // attempt, while preflight keeps its existing fail-closed behavior.
          (timeout.abortController ?? abortController).abort();
        }, timeout.milliseconds);
      }

      operation.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }

  /**
   * Create a child AbortController for one network request. Cancelling the
   * authorization still aborts it, but timing out this request does not mark the
   * complete authorization attempt as superseded.
   */
  private createAuthorizationOperationAbortController(
    authorizationAbortController: AbortController,
  ): { abortController: AbortController; cleanup: () => void } {
    const abortController = new AbortController();
    const handleAuthorizationAbort = () => abortController.abort();

    if (authorizationAbortController.signal.aborted) {
      abortController.abort();
    } else {
      authorizationAbortController.signal.addEventListener('abort', handleAuthorizationAbort, {
        once: true,
      });
    }

    return {
      abortController,
      cleanup: () =>
        authorizationAbortController.signal.removeEventListener('abort', handleAuthorizationAbort),
    };
  }

  private getRemainingOperationTimeout(
    deadline: number,
    message: string,
    abortController: AbortController,
  ) {
    return {
      abortController,
      message,
      milliseconds: Math.max(1, deadline - Date.now()),
    };
  }

  /**
   * Verify that the desktop connection origin matches the server's canonical
   * APP_URL before opening the browser. Cloud mode permits a temporary 404 for
   * rolling upgrades, while self-hosted mode must expose the endpoint so a
   * mismatched APP_URL cannot silently break the OAuth callback.
   */
  private async validateRemoteServerOrigin(
    remoteUrl: string,
    storageMode: DataSyncConfig['storageMode'],
    attemptId: number,
    abortController: AbortController,
  ): Promise<void> {
    const remoteOrigin = new URL(remoteUrl).origin;
    const configUrl = new URL('/api/desktop/auth-config', remoteUrl);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const timeoutMessage = `Timed out after ${REMOTE_CONFIG_TIMEOUT / 1000} seconds while verifying the remote server OIDC configuration`;
    const deadline = Date.now() + REMOTE_CONFIG_TIMEOUT;
    const remainingTimeout = () => ({
      message: timeoutMessage,
      milliseconds: Math.max(1, deadline - Date.now()),
    });
    appendVercelCookie(headers);

    let response: Response;
    try {
      response = await this.waitForAuthorizationOperation(
        netFetch(configUrl.toString(), {
          headers,
          method: 'GET',
          signal: abortController.signal,
        }),
        attemptId,
        abortController,
        remainingTimeout(),
      );
    } catch (error) {
      if (error instanceof AuthorizationSupersededError) throw error;
      if (getErrorMessage(error).startsWith('Timed out after')) throw error;
      throw new Error(
        `Unable to verify the remote server OIDC configuration: ${getErrorMessage(error)}`,
        { cause: error },
      );
    }

    this.ensureAuthorizationAttemptCurrent(attemptId, abortController);

    if (response.status === 404) {
      if (storageMode === 'selfHost') {
        throw new Error(
          'The self-hosted server does not expose /api/desktop/auth-config, so its APP_URL cannot be verified. Update the server before signing in.',
        );
      }
      logger.warn(
        'Desktop auth configuration endpoint is unavailable; continuing for compatibility',
      );
      return;
    }

    if (!response.ok) {
      const responseBody = await this.waitForAuthorizationOperation(
        response.text(),
        attemptId,
        abortController,
        remainingTimeout(),
      );
      this.ensureAuthorizationAttemptCurrent(attemptId, abortController);
      throw new Error(
        `Remote server OIDC configuration check failed: ${formatHttpResponseError(response, responseBody)}`,
      );
    }

    let data: { appUrl?: unknown };
    try {
      data = (await this.waitForAuthorizationOperation(
        response.json(),
        attemptId,
        abortController,
        remainingTimeout(),
      )) as { appUrl?: unknown };
    } catch (error) {
      if (error instanceof AuthorizationSupersededError) throw error;
      if (getErrorMessage(error) === timeoutMessage) throw error;
      throw new Error(
        `Remote server returned invalid desktop auth configuration: ${getErrorMessage(error)}`,
        { cause: error },
      );
    }
    this.ensureAuthorizationAttemptCurrent(attemptId, abortController);

    if (typeof data.appUrl !== 'string' || !data.appUrl.trim()) {
      throw new Error('Remote server desktop auth configuration is missing APP_URL');
    }

    let appOrigin: string;
    try {
      appOrigin = new URL(data.appUrl).origin;
    } catch {
      throw new Error('Remote server desktop auth configuration contains an invalid APP_URL');
    }

    if (appOrigin !== remoteOrigin) {
      throw new Error(
        `Remote server URL mismatch: connected to ${remoteOrigin}, but the server APP_URL is ${appOrigin}. Use ${appOrigin} or update the server APP_URL.`,
      );
    }
  }

  /**
   * Request OAuth authorization
   */
  @IpcMethod()
  async requestAuthorization(config: DataSyncConfig) {
    const pendingCommit = this.authorizationCommitPromise;
    this.clearAuthorizationState();
    const attemptId = this.authorizationAttemptId;
    const abortController = new AbortController();
    this.authorizationAbortController = abortController;
    this.authorizationInProgress = true;

    try {
      // A superseded attempt may already be committing tokens. Let it finish
      // (and roll itself back) before this attempt can reach its own exchange.
      if (pendingCommit) {
        const commitBarrier = await this.waitForAuthorizationOperation(
          pendingCommit,
          attemptId,
          abortController,
        );
        if (commitBarrier.rollbackError) {
          throw new Error(
            `Unable to safely start authorization because cleanup from the previous token commit failed: ${commitBarrier.rollbackError}`,
          );
        }
      }

      const remoteUrl = await this.waitForAuthorizationOperation(
        this.remoteServerConfigCtr.getRemoteServerUrl(config),
        attemptId,
        abortController,
      );
      this.ensureAuthorizationAttemptCurrent(attemptId, abortController);
      if (!remoteUrl) throw new Error('Remote server URL is required');

      logger.info(`Requesting OAuth authorization, storageMode:${config.storageMode}`);
      await this.validateRemoteServerOrigin(
        remoteUrl,
        config.storageMode,
        attemptId,
        abortController,
      );
      this.ensureAuthorizationAttemptCurrent(attemptId, abortController);

      // Generate PKCE parameters
      logger.debug('Generating PKCE parameters');
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = await this.waitForAuthorizationOperation(
        this.generateCodeChallenge(codeVerifier),
        attemptId,
        abortController,
      );
      this.ensureAuthorizationAttemptCurrent(attemptId, abortController);

      // Generate state parameter to prevent CSRF attacks
      const state = `${getProtocolScheme()}.${crypto.randomBytes(16).toString('hex')}`;
      this.authRequestState = state;
      const attempt: AuthorizationAttempt = {
        abortController,
        codeVerifier,
        id: attemptId,
        remoteUrl,
        state,
      };
      logger.debug('Generated authorization state');

      // Construct authorization URL with new redirect_uri
      const authUrl = new URL('/oidc/auth', remoteUrl);
      const redirectUri = this.constructRedirectUri(remoteUrl);

      logger.info('redirectUri', redirectUri);

      // Add query parameters
      authUrl.search = querystring.stringify({
        client_id: 'lobehub-desktop',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'consent',
        redirect_uri: redirectUri,
        // https://aihub.bielcrystal.com/pull/8450
        resource: 'urn:lobehub:chat',
        response_type: 'code',
        scope: 'openid profile email offline_access',
        state,
      });

      logger.info(`Constructed authorization request for ${authUrl.origin}${authUrl.pathname}`);

      // Open authorization URL in the default browser
      await this.waitForAuthorizationOperation(
        shell.openExternal(authUrl.toString()),
        attemptId,
        abortController,
      );
      if (!this.isAuthorizationAttemptActive(attempt)) {
        throw new AuthorizationSupersededError();
      }
      logger.debug('Opening authorization URL in default browser');

      this.broadcastAuthorizationProgress({
        elapsed: 0,
        maxPollTime: MAX_POLL_TIME,
        phase: 'browser_opened',
      });

      // Start polling for credentials
      this.startPolling(attempt);

      return { success: true };
    } catch (error) {
      if (!this.isAuthorizationAttemptCurrent(attemptId)) {
        return { error: 'Authorization request was cancelled or superseded', success: false };
      }
      logger.error('Authorization request failed:', error);
      this.clearAuthorizationState();
      return { error: getErrorMessage(error), success: false };
    }
  }

  /**
   * Cancel current authorization process
   */
  @IpcMethod()
  async cancelAuthorization() {
    if (this.authorizationInProgress) {
      logger.info('User cancelled authorization');
      this.clearAuthorizationState();
      this.broadcastAuthorizationProgress({
        elapsed: 0,
        maxPollTime: MAX_POLL_TIME,
        phase: 'cancelled',
      });
      return { success: true };
    }
    return { error: 'No active authorization', success: false };
  }

  /**
   * Request Market OAuth authorization (desktop)
   */
  @IpcMethod()
  async requestMarketAuthorization(params: MarketAuthorizationParams) {
    const { authUrl } = params;

    if (!authUrl) {
      const errorMessage = 'Market authorization URL is required';
      logger.error(errorMessage);
      return { error: errorMessage, success: false };
    }

    logger.info('Requesting market authorization in the system browser');
    try {
      await shell.openExternal(authUrl);
      logger.debug('Opening market authorization URL in default browser');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Market authorization request failed:', error);
      return { error: message, success: false };
    }
  }

  private focusOnboardingWindow() {
    try {
      const manager = this.app.browserManager;
      const window = manager?.getMainWindow()?.browserWindow;
      if (!window || window.isDestroyed()) return;

      const location = new URL(window.webContents.getURL());
      if (
        location.pathname.startsWith('/desktop-onboarding') ||
        location.hash.startsWith('#/desktop-onboarding')
      ) {
        manager.showMainWindow();
      }
    } catch (error) {
      logger.warn('Could not focus the desktop onboarding window:', error);
    }
  }

  /**
   * Start polling mechanism to get credentials
   */
  private startPolling(attempt: AuthorizationAttempt) {
    logger.info('Starting credential polling');

    const startTime = Date.now();
    let isPollingRequestInFlight = false;
    let lastPollingError: string | null = null;

    // Broadcast initial state
    this.broadcastAuthorizationProgress({
      elapsed: 0,
      maxPollTime: MAX_POLL_TIME,
      phase: 'waiting_for_auth',
    });

    this.pollingInterval = setInterval(async () => {
      // Ignore a late callback from an authorization attempt that was cancelled or replaced.
      if (!this.isAuthorizationAttemptActive(attempt)) return;

      const elapsed = Date.now() - startTime;

      // Broadcast progress on every tick
      this.broadcastAuthorizationProgress({
        elapsed,
        maxPollTime: MAX_POLL_TIME,
        phase: 'waiting_for_auth',
      });

      // Check the overall deadline even while an earlier network request is still pending.
      if (elapsed >= MAX_POLL_TIME) {
        const timeoutError = lastPollingError
          ? `Authorization timed out. Last polling error: ${lastPollingError}`
          : 'Authorization timed out';
        logger.warn(timeoutError);
        this.clearAuthorizationState();
        this.broadcastAuthorizationFailed(timeoutError);
        return;
      }

      // Do not overlap handoff requests when a network call takes longer than the interval.
      if (isPollingRequestInFlight) return;
      isPollingRequestInFlight = true;

      try {
        // Poll for credentials
        const result = await this.pollForCredentials(attempt);

        // A newer authorization attempt may have started while the request was in flight.
        if (!this.isAuthorizationAttemptActive(attempt)) return;

        if (result) {
          logger.info('Successfully received credentials from polling');
          this.stopPolling();

          // Broadcast verifying state
          this.broadcastAuthorizationProgress({
            elapsed,
            maxPollTime: MAX_POLL_TIME,
            phase: 'verifying',
          });

          // Validate state parameter
          if (result.state !== attempt.state) {
            logger.error('Invalid state parameter');
            this.clearAuthorizationState();
            this.broadcastAuthorizationFailed('Invalid state parameter');
            return;
          }

          // Exchange code for tokens
          const exchangeResult = await this.exchangeCodeForToken(result.code, attempt);

          if (exchangeResult.superseded || !this.isAuthorizationAttemptActive(attempt)) return;

          if (exchangeResult.success) {
            logger.info('Authorization successful');
            this.clearAuthorizationState();
            this.broadcastAuthorizationSuccessful();
            this.focusOnboardingWindow();
          } else {
            logger.warn(`Authorization failed: ${exchangeResult.error || 'Unknown error'}`);
            this.clearAuthorizationState();
            this.broadcastAuthorizationFailed(exchangeResult.error || 'Unknown error');
          }
        }
      } catch (error) {
        if (!this.isAuthorizationAttemptActive(attempt)) return;

        const errorMessage = getErrorMessage(error);
        if (error instanceof HandoffPollingError && error.retryable) {
          lastPollingError = errorMessage;
          logger.warn(`Retryable handoff polling error: ${errorMessage}`);
          return;
        }

        logger.error('Non-retryable error during credential polling:', error);
        this.clearAuthorizationState();
        this.broadcastAuthorizationFailed(errorMessage);
      } finally {
        isPollingRequestInFlight = false;
      }
    }, POLL_INTERVAL);
  }

  /**
   * Stop polling
   */
  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Clear authorization state
   * Called before starting a new authorization flow or after authorization failure/timeout
   */
  private clearAuthorizationState() {
    logger.debug('Clearing authorization state');
    this.authorizationInProgress = false;
    this.authorizationAttemptId += 1;
    this.authorizationAbortController?.abort();
    this.authorizationAbortController = null;
    this.stopPolling();
    this.authRequestState = null;
  }

  /**
   * Start auto-refresh timer
   */
  private startAutoRefresh() {
    // Stop existing timer first
    this.stopAutoRefresh();

    const checkInterval = 2 * 60 * 1000; // Check every 2 minutes
    logger.debug('Starting auto-refresh timer');

    this.autoRefreshTimer = setInterval(async () => {
      try {
        if (!this.remoteServerConfigCtr.isTokenExpiringSoon(TOKEN_REFRESH_BUFFER)) {
          return;
        }
        const expiresAt = this.remoteServerConfigCtr.getTokenExpiresAt();
        logger.info(
          `Token is expiring soon, triggering auto-refresh. Expires at: ${expiresAt ? new Date(expiresAt).toISOString() : 'unknown'}`,
        );

        const result = await this.remoteServerConfigCtr.refreshAccessToken();
        if (result.success) {
          logger.info('Auto-refresh successful');
          this.broadcastTokenRefreshed();
        } else {
          logger.error(`Auto-refresh failed after retries: ${result.error}`);

          // Only clear tokens for non-retryable errors (e.g., invalid_grant)
          // The retry mechanism in RemoteServerConfigCtr already handles transient errors
          if (this.remoteServerConfigCtr.isNonRetryableError(result.error)) {
            logger.warn(
              'Non-retryable error detected, clearing tokens and requiring re-authorization',
            );
            this.stopAutoRefresh();
            await this.remoteServerConfigCtr.clearTokens();
            await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
            this.broadcastAuthorizationRequired(
              `auto-refresh:non_retryable ${result.error ?? ''}`.trim(),
            );
          } else {
            // For other errors (after retries exhausted), log but don't clear tokens immediately
            // The next refresh cycle will retry
            logger.warn('Refresh failed but error may be transient, will retry on next cycle');
          }
        }
      } catch (error) {
        logger.error('Error during auto-refresh check:', error);
      }
    }, checkInterval);
  }

  /**
   * Stop auto-refresh timer
   */
  private stopAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
      logger.debug('Stopped auto-refresh timer');
    }
  }

  /**
   * Poll for credentials
   * Sends HTTP request directly to remote server
   */
  private async pollForCredentials(
    attempt: AuthorizationAttempt,
  ): Promise<{ code: string; state: string } | null> {
    // Construct request URL
    const url = new URL('/oidc/handoff', attempt.remoteUrl);
    url.searchParams.set('id', attempt.state);
    url.searchParams.set('client', 'desktop');

    logger.debug(`Polling for credentials at ${url.origin}${url.pathname}`);

    // Use Electron net.fetch to respect system CA store (self-signed/private CA certs)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    appendVercelCookie(headers);
    const deadline = Date.now() + HANDOFF_REQUEST_TIMEOUT;
    const requestTimeoutMessage = `Timed out after ${HANDOFF_REQUEST_TIMEOUT / 1000} seconds while polling authorization handoff`;
    const operation = this.createAuthorizationOperationAbortController(attempt.abortController);

    try {
      let response: Response;
      try {
        response = await this.waitForAuthorizationOperation(
          netFetch(url.toString(), {
            headers,
            method: 'GET',
            signal: operation.abortController.signal,
          }),
          attempt.id,
          attempt.abortController,
          this.getRemainingOperationTimeout(
            deadline,
            requestTimeoutMessage,
            operation.abortController,
          ),
        );
      } catch (error) {
        if (error instanceof AuthorizationSupersededError) throw error;
        const errorMessage = getErrorMessage(error);
        throw new HandoffPollingError(
          errorMessage === requestTimeoutMessage
            ? errorMessage
            : `Network error while polling authorization: ${errorMessage}`,
          true,
        );
      }

      if (response.status === 404) {
        // Credentials are not ready yet. This is the only normal pending response.
        return null;
      }

      if (!response.ok) {
        const httpReason = formatHttpResponseError(response);
        const retryable = response.status === 429 || response.status >= 500;
        const bodyTimeoutMessage = `${httpReason}: timed out after ${HANDOFF_REQUEST_TIMEOUT / 1000} seconds while reading the handoff error response`;
        let responseBody: string;
        try {
          responseBody = await this.waitForAuthorizationOperation(
            response.text(),
            attempt.id,
            attempt.abortController,
            this.getRemainingOperationTimeout(
              deadline,
              bodyTimeoutMessage,
              operation.abortController,
            ),
          );
        } catch (error) {
          if (error instanceof AuthorizationSupersededError) throw error;
          const errorMessage = getErrorMessage(error);
          throw new HandoffPollingError(
            errorMessage === bodyTimeoutMessage
              ? errorMessage
              : `${httpReason}: failed to read the handoff error response: ${errorMessage}`,
            retryable,
          );
        }

        throw new HandoffPollingError(formatHttpResponseError(response, responseBody), retryable);
      }

      let data: {
        data?: {
          id?: string;
          payload?: { code?: string; state?: string };
        };
        success?: boolean;
      };
      const successBodyTimeoutMessage = `Timed out after ${HANDOFF_REQUEST_TIMEOUT / 1000} seconds while reading the successful HTTP ${response.status} handoff response`;
      try {
        data = (await this.waitForAuthorizationOperation(
          response.json(),
          attempt.id,
          attempt.abortController,
          this.getRemainingOperationTimeout(
            deadline,
            successBodyTimeoutMessage,
            operation.abortController,
          ),
        )) as typeof data;
      } catch (error) {
        if (error instanceof AuthorizationSupersededError) throw error;
        const errorMessage = getErrorMessage(error);
        throw new HandoffPollingError(
          errorMessage === successBodyTimeoutMessage
            ? errorMessage
            : `Invalid handoff response: ${errorMessage}`,
          false,
        );
      }

      const code = data.data?.payload?.code;
      const state = data.data?.payload?.state;
      if (data.success && code && state) {
        logger.debug('Successfully retrieved credentials from handoff');
        return { code, state };
      }

      throw new HandoffPollingError(
        'Invalid handoff response: expected a successful payload containing code and state',
        false,
      );
    } finally {
      operation.cleanup();
    }
  }

  /**
   * Refresh access token
   * This method includes retry mechanism via RemoteServerConfigCtr.refreshAccessToken()
   */
  async refreshAccessToken() {
    logger.info('Starting to refresh access token');
    try {
      // Call the centralized refresh logic in RemoteServerConfigCtr (includes retry)
      const result = await this.remoteServerConfigCtr.refreshAccessToken();

      if (result.success) {
        logger.info('Token refresh successful via AuthCtr call.');
        // Notify render process that token has been refreshed
        this.broadcastTokenRefreshed();
        // Restart auto-refresh timer with new expiration time
        this.startAutoRefresh();
        return { success: true };
      } else {
        logger.error(`Token refresh failed via AuthCtr call: ${result.error}`);

        // Only clear tokens for non-retryable errors (e.g., invalid_grant)
        if (this.remoteServerConfigCtr.isNonRetryableError(result.error)) {
          logger.warn(
            'Non-retryable error detected, clearing tokens and requiring re-authorization',
          );
          this.stopAutoRefresh();
          await this.remoteServerConfigCtr.clearTokens();
          await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
          this.broadcastAuthorizationRequired(`refresh:non_retryable ${result.error ?? ''}`.trim());
        } else {
          // For transient errors, don't clear tokens - allow manual retry
          logger.warn('Refresh failed but error may be transient, tokens preserved for retry');
        }

        return { error: result.error, success: false };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Token refresh operation failed via AuthCtr:', errorMessage);

      // Only clear tokens for non-retryable errors
      if (this.remoteServerConfigCtr.isNonRetryableError(errorMessage)) {
        logger.warn('Non-retryable error in catch block, clearing tokens');
        this.stopAutoRefresh();
        await this.remoteServerConfigCtr.clearTokens();
        await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
        this.broadcastAuthorizationRequired(`refresh:exception ${errorMessage}`);
      }

      return { error: errorMessage, success: false };
    }
  }

  /**
   * Exchange authorization code for token
   */
  private async exchangeCodeForToken(
    code: string,
    attempt: AuthorizationAttempt,
  ): Promise<TokenExchangeResult> {
    if (!this.isAuthorizationAttemptActive(attempt)) {
      return { success: false, superseded: true };
    }

    const { remoteUrl } = attempt;
    const deadline = Date.now() + TOKEN_EXCHANGE_TIMEOUT;
    const timeoutMessage = `Timed out after ${TOKEN_EXCHANGE_TIMEOUT / 1000} seconds while exchanging authorization code for token`;
    const operation = this.createAuthorizationOperationAbortController(attempt.abortController);
    logger.info('Starting to exchange authorization code for token');
    try {
      const tokenUrl = new URL('/oidc/token', remoteUrl);
      logger.debug(`Constructed token exchange URL: ${tokenUrl.toString()}`);

      // Construct request body
      const body = querystring.stringify({
        client_id: 'lobehub-desktop',
        code,
        code_verifier: attempt.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: this.constructRedirectUri(remoteUrl),
      });

      logger.debug('Sending token exchange request');
      // Send request to get token
      const tokenHeaders: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      appendVercelCookie(tokenHeaders);
      const response = await this.waitForAuthorizationOperation(
        netFetch(tokenUrl.toString(), {
          body,
          headers: tokenHeaders,
          method: 'POST',
          signal: operation.abortController.signal,
        }),
        attempt.id,
        attempt.abortController,
        this.getRemainingOperationTimeout(deadline, timeoutMessage, operation.abortController),
      );

      if (!this.isAuthorizationAttemptActive(attempt)) {
        return { success: false, superseded: true };
      }

      if (!response.ok) {
        const httpReason = formatHttpResponseError(response);
        let responseBody: string;
        try {
          responseBody = await this.waitForAuthorizationOperation(
            response.text(),
            attempt.id,
            attempt.abortController,
            this.getRemainingOperationTimeout(deadline, timeoutMessage, operation.abortController),
          );
        } catch (error) {
          if (error instanceof AuthorizationSupersededError) throw error;
          if (getErrorMessage(error) === timeoutMessage) throw error;
          throw new Error(
            `Failed to get token: ${httpReason}; failed to read the error response: ${getErrorMessage(error)}`,
            { cause: error },
          );
        }

        const errorMessage = `Failed to get token: ${formatHttpResponseError(response, responseBody)}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      let data;

      // Parse response
      try {
        data = await this.waitForAuthorizationOperation(
          response.clone().json(),
          attempt.id,
          attempt.abortController,
          this.getRemainingOperationTimeout(deadline, timeoutMessage, operation.abortController),
        );
      } catch (error) {
        if (error instanceof AuthorizationSupersededError) throw error;
        if (getErrorMessage(error) === timeoutMessage) throw error;
        const status = response.status;
        let responseDetail: string;
        try {
          responseDetail = await this.waitForAuthorizationOperation(
            response.text(),
            attempt.id,
            attempt.abortController,
            this.getRemainingOperationTimeout(deadline, timeoutMessage, operation.abortController),
          );
        } catch (detailError) {
          if (detailError instanceof AuthorizationSupersededError) throw detailError;
          if (getErrorMessage(detailError) === timeoutMessage) throw detailError;
          responseDetail = `Unable to read response body: ${getErrorMessage(detailError)}`;
        }

        throw new Error(
          `Parse JSON failed, please check your server, response status: ${status}, detail:\n\n ${responseDetail} `,
          { cause: error },
        );
      }

      if (!this.isAuthorizationAttemptActive(attempt)) {
        return { success: false, superseded: true };
      }

      logger.debug('Successfully received token exchange response');

      // Ensure response contains necessary fields
      if (!data.access_token || !data.refresh_token) {
        logger.error('Invalid token response: missing access_token or refresh_token');
        throw new Error('Invalid token response: missing required fields');
      }

      const commit = this.commitAuthorizationTokens(data, attempt);
      const commitCompletion = commit.then(
        () => ({}),
        (error): AuthorizationCommitBarrierResult => ({
          rollbackError:
            error instanceof AuthorizationRollbackError ? getErrorMessage(error) : undefined,
        }),
      );
      this.authorizationCommitPromise = commitCompletion;

      try {
        return await commit;
      } finally {
        if (this.authorizationCommitPromise === commitCompletion) {
          this.authorizationCommitPromise = null;
        }
      }
    } catch (error) {
      if (error instanceof AuthorizationRollbackError) {
        logger.error('Authorization token rollback failed:', error);
        return { error: getErrorMessage(error), success: false };
      }
      if (
        error instanceof AuthorizationSupersededError ||
        !this.isAuthorizationAttemptActive(attempt)
      ) {
        return { success: false, superseded: true };
      }
      logger.error('Exchanging authorization code failed:', error);
      return { error: getErrorMessage(error), success: false };
    } finally {
      operation.cleanup();
    }
  }

  private async commitAuthorizationTokens(
    data: { access_token: string; expires_in?: number; refresh_token: string },
    attempt: AuthorizationAttempt,
  ): Promise<TokenExchangeResult> {
    let persistenceStarted = false;
    let rollbackAttempted = false;
    const rollback = async () => {
      rollbackAttempted = true;
      await this.rollbackAuthorizationCommit();
    };

    try {
      if (!this.isAuthorizationAttemptActive(attempt)) {
        return { success: false, superseded: true };
      }

      const isOriginCurrent = this.remoteServerConfigCtr.isRemoteServerOriginCurrent(
        attempt.remoteUrl,
      );
      if (!this.isAuthorizationAttemptActive(attempt)) {
        return { success: false, superseded: true };
      }
      if (!isOriginCurrent) {
        return {
          error: 'Remote server changed before exchanged tokens could be saved',
          success: false,
        };
      }

      logger.debug('Starting to save exchanged tokens');
      persistenceStarted = true;
      await this.remoteServerConfigCtr.saveTokens(
        data.access_token,
        data.refresh_token,
        data.expires_in,
      );

      if (!this.isAuthorizationAttemptActive(attempt)) {
        await rollback();
        return { success: false, superseded: true };
      }
      logger.info('Successfully saved exchanged tokens');

      logger.debug('Setting authorized remote server to active state');
      const activated = this.remoteServerConfigCtr.activateRemoteServerForOrigin(attempt.remoteUrl);

      if (!activated) {
        await rollback();
        return {
          error: 'Remote server changed before exchanged tokens could be activated',
          success: false,
        };
      }

      if (!this.isAuthorizationAttemptActive(attempt)) {
        await rollback();
        return { success: false, superseded: true };
      }

      this.startAutoRefresh();
      this.connectGateway();

      return { success: true };
    } catch (error) {
      if (persistenceStarted && !rollbackAttempted) await rollback();
      if (error instanceof AuthorizationRollbackError) throw error;
      if (!this.isAuthorizationAttemptActive(attempt)) {
        return { success: false, superseded: true };
      }
      throw error;
    }
  }

  private async rollbackAuthorizationCommit(): Promise<void> {
    logger.warn('Rolling back tokens from a cancelled or failed authorization commit');
    try {
      await this.remoteServerConfigCtr.clearTokens();
      await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
    } catch (error) {
      logger.error('Failed to roll back authorization tokens:', error);
      throw new AuthorizationRollbackError(
        `Failed to roll back authorization tokens: ${getErrorMessage(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Connect to device gateway (fire-and-forget)
   */
  private connectGateway() {
    const gatewaySrv = this.app.getService(GatewayConnectionService);
    if (gatewaySrv) {
      logger.info('Triggering gateway connection after login');
      gatewaySrv.connect().catch((error) => {
        logger.error('Gateway connection after login failed:', error);
      });
    }
  }

  /**
   * Broadcast token refreshed event
   */
  private broadcastTokenRefreshed() {
    logger.debug('Broadcasting tokenRefreshed event to all windows');
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('tokenRefreshed');
      }
    }
  }

  /**
   * Broadcast authorization successful event
   */
  private broadcastAuthorizationSuccessful() {
    logger.debug('Broadcasting authorizationSuccessful event to all windows');
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationSuccessful');
      }
    }
  }

  /**
   * Broadcast authorization progress event
   */
  private broadcastAuthorizationProgress(progress: AuthorizationProgress) {
    // Avoid logging too frequently
    // logger.debug('Broadcasting authorizationProgress event');
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationProgress', progress);
      }
    }
  }

  /**
   * Broadcast authorization failed event
   */
  private broadcastAuthorizationFailed(error: string) {
    logger.debug(`Broadcasting authorizationFailed event to all windows, error: ${error}`);
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationFailed', { error });
      }
    }
  }

  /**
   * Broadcast authorization required event.
   * `reason` is a short tag (e.g. `refresh:invalid_grant`, `startup:non_retryable`)
   * recorded so the renderer can log why the Session Expired modal appeared.
   */
  private broadcastAuthorizationRequired(reason: string) {
    logger.info(`Broadcasting authorizationRequired event (reason=${reason})`);
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationRequired', { reason });
      }
    }
  }

  /**
   * Generate PKCE codeVerifier
   */
  private generateCodeVerifier(): string {
    logger.debug('Generating PKCE code verifier');
    // Generate a random string of at least 43 characters
    const verifier = crypto
      .randomBytes(32)
      .toString('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    logger.debug('Generated code verifier (partial): ' + verifier.slice(0, 10) + '...'); // Avoid logging full sensitive info
    return verifier;
  }

  /**
   * Generate codeChallenge from codeVerifier (S256 method)
   */
  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    logger.debug('Generating PKCE code challenge (S256)');
    // Hash codeVerifier using SHA-256
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data.buffer);

    // Convert hash result to base64url encoding
    const challenge = Buffer.from(digest)
      .toString('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    logger.debug('Generated code challenge (partial): ' + challenge.slice(0, 10) + '...'); // Avoid logging full sensitive info
    return challenge;
  }

  /**
   * Initialize after app is ready
   */
  afterAppReady() {
    logger.debug('AuthCtr initialized, checking for existing tokens');
    this.initializeAutoRefresh();
  }

  /**
   * Clean up all timers
   */
  cleanup() {
    logger.debug('Cleaning up AuthCtr timers');
    this.clearAuthorizationState();
    this.stopAutoRefresh();
  }

  /**
   * Initialize auto-refresh functionality
   * Checks for valid token at app startup and starts auto-refresh timer if token exists
   * Proactively refreshes the token only when it is expired or near expiry
   */
  private async initializeAutoRefresh() {
    try {
      const config = await this.remoteServerConfigCtr.getRemoteServerConfig();

      // Check if remote server is configured and active
      if (!(await this.remoteServerConfigCtr.isRemoteServerConfigured(config))) {
        logger.debug(
          'Remote server not active or configured, skipping auto-refresh initialization',
        );
        return;
      }

      // Check if valid access token exists
      const accessToken = await this.remoteServerConfigCtr.getAccessToken();
      if (!accessToken) {
        logger.debug('No access token found, skipping auto-refresh initialization');
        return;
      }

      // Check if token expiration time exists
      const expiresAt = this.remoteServerConfigCtr.getTokenExpiresAt();
      if (!expiresAt) {
        logger.debug('No token expiration time found, skipping auto-refresh initialization');
        return;
      }

      // Refresh proactively only when the token is actually near expiry. The access
      // token is long-lived; refreshing on every launch just multiplies refresh-token
      // rotations — and the chance of a lost-response logout — for no benefit.
      if (this.remoteServerConfigCtr.isTokenExpiringSoon(TOKEN_REFRESH_BUFFER)) {
        logger.info('Token is expired or expiring soon, refreshing on startup');
        await this.performProactiveRefresh();
        return;
      }

      // Start auto-refresh timer
      logger.info(
        `Token is valid, starting auto-refresh timer. Token expires at: ${new Date(expiresAt).toISOString()}`,
      );
      this.startAutoRefresh();
    } catch (error) {
      logger.error('Error during auto-refresh initialization:', error);
    }
  }

  /**
   * Perform proactive token refresh (used on startup and app activation)
   */
  private async performProactiveRefresh(): Promise<void> {
    const refreshResult = await this.remoteServerConfigCtr.refreshAccessToken();
    if (refreshResult.success) {
      logger.info('Proactive token refresh successful');
      this.broadcastTokenRefreshed();
      this.startAutoRefresh();
    } else {
      logger.error(`Proactive token refresh failed: ${refreshResult.error}`);

      // Only clear token for non-retryable errors
      if (this.remoteServerConfigCtr.isNonRetryableError(refreshResult.error)) {
        logger.warn('Non-retryable error during proactive refresh, clearing tokens');
        await this.remoteServerConfigCtr.clearTokens();
        await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
        this.broadcastAuthorizationRequired(
          `startup:non_retryable ${refreshResult.error ?? ''}`.trim(),
        );
      } else {
        // For transient errors, still start auto-refresh timer to retry later
        logger.warn('Transient error during proactive refresh, will retry via auto-refresh');
        this.startAutoRefresh();
      }
    }
  }

  /**
   * Handle app activation event (e.g., Mac dock click, window focus)
   * Proactively refresh token if it is expired or near expiry
   */
  async onAppActivate(): Promise<void> {
    logger.debug('App activated, checking if token refresh is needed');

    try {
      const config = await this.remoteServerConfigCtr.getRemoteServerConfig();

      // Check if remote server is configured and active
      if (!(await this.remoteServerConfigCtr.isRemoteServerConfigured(config))) {
        logger.debug('Remote server not active, skipping activation refresh');
        return;
      }

      // Check if valid access token exists
      const accessToken = await this.remoteServerConfigCtr.getAccessToken();
      if (!accessToken) {
        logger.debug('No access token found, skipping activation refresh');
        return;
      }

      // Refresh only when the token is actually near expiry (see initializeAutoRefresh).
      if (this.remoteServerConfigCtr.isTokenExpiringSoon(TOKEN_REFRESH_BUFFER)) {
        logger.info('Token is expiring soon on app activation, refreshing token');
        await this.performProactiveRefresh();
      } else {
        logger.debug('Token is still valid, skipping activation refresh');
      }
    } catch (error) {
      logger.error('Error during app activation refresh check:', error);
    }
  }
}
