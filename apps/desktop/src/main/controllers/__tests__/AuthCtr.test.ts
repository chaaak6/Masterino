import type { DataSyncConfig } from '@lobechat/electron-client-ipc';
import { BrowserWindow, shell } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import AuthCtr from '../AuthCtr';
import RemoteServerConfigCtr from '../RemoteServerConfigCtr';

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// AuthCtr only asks the app container for this service after a successful token exchange.
// Keep this controller test isolated from the gateway service's workspace-package dependencies.
vi.mock('@/services/gatewayConnectionSrv', () => ({
  default: class GatewayConnectionService {},
}));

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

// Mock electron
vi.mock('electron', () => ({
  app: { getPath: () => '/Applications/Masterino.app', name: 'Masterino' },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    handle: ipcMainHandleMock,
  },
  net: {
    fetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      global.fetch(input as any, init as any),
    ),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buffer: Buffer) => buffer.toString()),
  },
}));

// Mock electron-is
vi.mock('electron-is', () => ({
  macOS: vi.fn(() => false),
  windows: vi.fn(() => false),
  linux: vi.fn(() => false),
}));

// Mock OFFICIAL_CLOUD_SERVER
vi.mock('@/const/env', () => ({
  OFFICIAL_CLOUD_SERVER: 'https://masterino.bielcrystal.com',
  isMac: false,
  isWindows: false,
  isLinux: false,
  isDev: false,
}));

// Mock crypto
let randomBytesCounter = 0;
vi.mock('node:crypto', () => ({
  default: {
    randomBytes: vi.fn((_size: number) => {
      randomBytesCounter++;
      return {
        toString: vi.fn(() => `mock-random-${randomBytesCounter}`),
      };
    }),
    subtle: {
      digest: vi.fn(() => Promise.resolve(new ArrayBuffer(32))),
    },
  },
}));

// Create mock App and RemoteServerConfigCtr
const mockRemoteServerConfigCtr = {
  activateRemoteServerForOrigin: vi.fn().mockReturnValue(true),
  clearTokens: vi.fn().mockResolvedValue(undefined),
  getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
  getLastTokenRefreshAt: vi.fn().mockReturnValue(Date.now()),
  getRemoteServerConfig: vi.fn().mockResolvedValue({ active: true, storageMode: 'cloud' }),
  getRemoteServerUrl: vi.fn().mockImplementation(async (config?: DataSyncConfig) => {
    if (config?.storageMode === 'selfHost') {
      return config.remoteServerUrl || 'https://mock-server.com';
    }
    return config?.remoteServerUrl || 'https://masterino.bielcrystal.com';
  }),
  getTokenExpiresAt: vi.fn().mockReturnValue(Date.now() + 3600000),
  isNonRetryableError: vi.fn().mockReturnValue(false),
  isRemoteServerOriginCurrent: vi.fn().mockReturnValue(true),
  isRemoteServerConfigured: vi.fn().mockResolvedValue(true),
  isTokenExpiringSoon: vi.fn().mockReturnValue(false),
  refreshAccessToken: vi.fn().mockResolvedValue({ success: true }),
  saveTokens: vi.fn().mockResolvedValue(undefined),
  setRemoteServerConfig: vi.fn().mockResolvedValue(true),
} as unknown as RemoteServerConfigCtr;

const mockApp = {
  getController: vi.fn((ControllerClass) => {
    if (ControllerClass === RemoteServerConfigCtr) {
      return mockRemoteServerConfigCtr;
    }
    return null;
  }),
  getService: vi.fn(() => null),
} as unknown as App;

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
};

describe('AuthCtr', () => {
  let authCtr: AuthCtr;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockWindow: any;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMainHandleMock.mockClear();
    randomBytesCounter = 0; // Reset counter for each test

    // Reset shell.openExternal to default successful behavior
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    vi.mocked(mockRemoteServerConfigCtr.activateRemoteServerForOrigin).mockReturnValue(true);
    vi.mocked(mockRemoteServerConfigCtr.isRemoteServerOriginCurrent).mockReturnValue(true);

    // Create fresh instance for each test
    authCtr = new AuthCtr(mockApp);

    // Mock global fetch
    mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
    global.fetch = mockFetch;

    // Mock BrowserWindow with send spy
    mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: vi.fn(),
      },
    };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow]);
  });

  afterEach(() => {
    // Clean up authCtr intervals (using real timers, not fake timers)
    authCtr?.cleanup?.();
    // Clean up any fake timers if used
    vi.clearAllTimers();
  });

  describe('Basic functionality', () => {
    // Use real timers for all tests since setInterval with async doesn't work well with fake timers

    describe('requestAuthorization', () => {
      it('should generate PKCE parameters and open authorization URL', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockResolvedValue({
          status: 404,
          ok: false,
        });

        const result = await authCtr.requestAuthorization(config);

        // Verify success response
        expect(result).toEqual({ success: true });

        // Verify shell.openExternal was called with correct URL
        expect(shell.openExternal).toHaveBeenCalledWith(
          expect.stringContaining('https://masterino.bielcrystal.com/oidc/auth'),
        );

        // Verify URL contains required parameters
        const authUrl = vi.mocked(shell.openExternal).mock.calls[0][0];
        expect(authUrl).toContain('client_id=lobehub-desktop');
        expect(authUrl).toContain('response_type=code');
        expect(authUrl).toContain('code_challenge_method=S256');
        expect(authUrl).toContain('scope=openid%20profile%20email%20offline_access');
      });

      it('should start polling after authorization request', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockResolvedValue({
          status: 404,
          ok: false,
        });

        const result = await authCtr.requestAuthorization(config);
        expect(result.success).toBe(true);

        // Wait a bit for polling to start
        await new Promise((resolve) => setTimeout(resolve, 3500));

        // Verify fetch was called for polling
        const pollingCalls = mockFetch.mock.calls.filter((call) =>
          (call[0] as string).includes('/oidc/handoff'),
        );
        expect(pollingCalls.length).toBeGreaterThan(0);
      });

      it('should use self-hosted server URL when storageMode is selfHost', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'selfHost',
          remoteServerUrl: 'https://my-custom-server.com',
        };

        mockFetch.mockImplementation((url: string) => {
          if (new URL(url).pathname === '/api/desktop/auth-config') {
            return Promise.resolve({
              json: () => Promise.resolve({ appUrl: 'https://my-custom-server.com' }),
              ok: true,
              status: 200,
            });
          }

          return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
        });

        await authCtr.requestAuthorization(config);

        // Verify shell.openExternal was called with custom URL
        expect(shell.openExternal).toHaveBeenCalledWith(
          expect.stringContaining('https://my-custom-server.com/oidc/auth'),
        );
      });

      it('should require the auth configuration endpoint in self-hosted mode', async () => {
        const result = await authCtr.requestAuthorization({
          active: false,
          remoteServerUrl: 'https://legacy-self-hosted.example.com',
          storageMode: 'selfHost',
        });

        expect(result).toEqual({
          error:
            'The self-hosted server does not expose /api/desktop/auth-config, so its APP_URL cannot be verified. Update the server before signing in.',
          success: false,
        });
        expect(shell.openExternal).not.toHaveBeenCalled();
      });

      it('allows a configured Cloud alias when the compatibility endpoint is unavailable', async () => {
        const result = await authCtr.requestAuthorization({
          active: false,
          remoteServerUrl: 'https://mlai-test.bielcrystal.com',
          storageMode: 'cloud',
        });

        expect(result).toEqual({ success: true });
        expect(shell.openExternal).toHaveBeenCalledWith(
          expect.stringContaining('https://mlai-test.bielcrystal.com/oidc/auth'),
        );
      });

      it('should fail before opening the browser when self-hosted URL differs from APP_URL', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'selfHost',
          remoteServerUrl: 'https://self-hosted.example.com',
        };

        mockFetch.mockResolvedValue({
          json: vi.fn().mockResolvedValue({ appUrl: 'https://canonical.example.com' }),
          ok: true,
          status: 200,
        });

        const result = await authCtr.requestAuthorization(config);

        expect(result).toEqual({
          error:
            'Remote server URL mismatch: connected to https://self-hosted.example.com, but the server APP_URL is https://canonical.example.com. Use https://canonical.example.com or update the server APP_URL.',
          success: false,
        });
        expect(shell.openExternal).not.toHaveBeenCalled();
      });

      it('should continue when self-hosted URL matches the server APP_URL', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'selfHost',
          remoteServerUrl: 'https://self-hosted.example.com',
        };

        mockFetch.mockImplementation((url: string) => {
          if (new URL(url).pathname === '/api/desktop/auth-config') {
            return Promise.resolve({
              json: () => Promise.resolve({ appUrl: 'https://self-hosted.example.com/' }),
              ok: true,
              status: 200,
            });
          }

          return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
        });

        const result = await authCtr.requestAuthorization(config);

        expect(result).toEqual({ success: true });
        expect(shell.openExternal).toHaveBeenCalledWith(
          expect.stringContaining('https://self-hosted.example.com/oidc/auth'),
        );
      });

      it('should handle authorization request error gracefully', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        vi.mocked(shell.openExternal).mockRejectedValue(new Error('Failed to open browser'));

        const result = await authCtr.requestAuthorization(config);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to open browser');
      });
    });

    describe('polling mechanism', () => {
      it('should poll every 3 seconds', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockResolvedValue({
          status: 404,
          ok: false,
        });

        await authCtr.requestAuthorization(config);

        // Wait for first poll
        await new Promise((resolve) => setTimeout(resolve, 3100));

        const firstCallCount = mockFetch.mock.calls.filter((call) =>
          (call[0] as string).includes('/oidc/handoff'),
        ).length;
        expect(firstCallCount).toBeGreaterThanOrEqual(1);

        // Wait for second poll
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const secondCallCount = mockFetch.mock.calls.filter((call) =>
          (call[0] as string).includes('/oidc/handoff'),
        ).length;
        expect(secondCallCount).toBeGreaterThanOrEqual(2);
      }, 10000);

      it('should stop polling when credentials are received', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        let pollCount = 0;
        mockFetch.mockImplementation((url: string) => {
          const urlObj = new URL(url);

          // Return success on third poll
          if (urlObj.pathname.includes('/oidc/handoff')) {
            pollCount++;
            if (pollCount >= 3) {
              return Promise.resolve({
                status: 200,
                ok: true,
                json: () =>
                  Promise.resolve({
                    success: true,
                    data: {
                      payload: {
                        code: 'mock-auth-code',
                        state: 'lobehub.mock-random-2', // Second randomBytes call is for state
                      },
                    },
                  }),
                text: () => Promise.resolve('mock response'),
              });
            }
          }

          // Token exchange endpoint
          if (urlObj.pathname.includes('/oidc/token')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  access_token: 'new-access-token',
                  refresh_token: 'new-refresh-token',
                  expires_in: 3600,
                }),
              text: () => Promise.resolve('mock response'),
              clone: () => ({
                json: () =>
                  Promise.resolve({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                  }),
              }),
            });
          }

          return Promise.resolve({
            status: 404,
            ok: false,
          });
        });

        await authCtr.requestAuthorization(config);

        // Wait for polling to complete
        await new Promise((resolve) => setTimeout(resolve, 10000));

        const pollCountBefore = pollCount;

        // Wait more time and verify no more polling
        await new Promise((resolve) => setTimeout(resolve, 3500));
        expect(pollCount).toBe(pollCountBefore);
      }, 15000);

      it('should broadcast authorizationSuccessful when credentials are exchanged', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockImplementation((url: string) => {
          const urlObj = new URL(url);

          if (urlObj.pathname.includes('/oidc/handoff')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  success: true,
                  data: {
                    payload: {
                      code: 'mock-auth-code',
                      state: 'lobehub.mock-random-2', // Second randomBytes call is for state
                    },
                  },
                }),
              text: () => Promise.resolve('mock response'),
            });
          }

          if (urlObj.pathname.includes('/oidc/token')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  access_token: 'new-access-token',
                  refresh_token: 'new-refresh-token',
                  expires_in: 3600,
                }),
              text: () => Promise.resolve('mock response'),
              clone: () => ({
                json: () =>
                  Promise.resolve({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                  }),
              }),
            });
          }

          return Promise.resolve({ status: 404, ok: false });
        });

        await authCtr.requestAuthorization(config);

        // Wait for polling to complete and token exchange
        await new Promise((resolve) => setTimeout(resolve, 4000));

        // Verify authorizationSuccessful was broadcast
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationSuccessful');
      }, 6000);

      it('should validate state parameter and reject mismatched state', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockImplementation((url: string) => {
          const urlObj = new URL(url);

          if (urlObj.pathname.includes('/oidc/handoff')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  success: true,
                  data: {
                    payload: {
                      code: 'mock-auth-code',
                      state: 'wrong-state', // Mismatched state
                    },
                  },
                }),
            });
          }

          return Promise.resolve({ status: 404, ok: false });
        });

        await authCtr.requestAuthorization(config);

        // Wait for polling and state validation
        await new Promise((resolve) => setTimeout(resolve, 4000));

        // Verify authorizationFailed was broadcast with state error
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
          error: 'Invalid state parameter',
        });
      }, 6000);
    });

    describe('token refresh', () => {
      it('should start auto-refresh after successful authorization', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockImplementation((url: string) => {
          const urlObj = new URL(url);

          if (urlObj.pathname.includes('/oidc/handoff')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  success: true,
                  data: {
                    payload: {
                      code: 'mock-auth-code',
                      state: 'lobehub.mock-random-2', // Second randomBytes call is for state
                    },
                  },
                }),
              text: () => Promise.resolve('mock response'),
            });
          }

          if (urlObj.pathname.includes('/oidc/token')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  access_token: 'new-access-token',
                  refresh_token: 'new-refresh-token',
                  expires_in: 3600,
                }),
              text: () => Promise.resolve('mock response'),
              clone: () => ({
                json: () =>
                  Promise.resolve({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                  }),
              }),
            });
          }

          return Promise.resolve({ status: 404, ok: false });
        });

        await authCtr.requestAuthorization(config);

        // Wait for polling and token exchange
        await new Promise((resolve) => setTimeout(resolve, 4000));

        // Verify saveTokens was called
        expect(mockRemoteServerConfigCtr.saveTokens).toHaveBeenCalledWith(
          'new-access-token',
          'new-refresh-token',
          3600,
        );

        // Verify only the still-current origin was atomically activated.
        expect(mockRemoteServerConfigCtr.activateRemoteServerForOrigin).toHaveBeenCalledWith(
          'https://masterino.bielcrystal.com',
        );
      }, 6000);
    });
  });

  describe('Authorization attempt isolation', () => {
    const cloudConfig: DataSyncConfig = { active: false, storageMode: 'cloud' };

    const mockSuccessfulCloudHandoffAndToken = () => {
      mockFetch.mockImplementation((url: string) => {
        const pathname = new URL(url).pathname;
        if (pathname === '/api/desktop/auth-config') {
          return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
        }
        if (pathname === '/oidc/handoff') {
          return Promise.resolve({
            json: () =>
              Promise.resolve({
                data: { payload: { code: 'authorization-code', state: 'lobehub.mock-random-2' } },
                success: true,
              }),
            ok: true,
            status: 200,
          });
        }
        if (pathname === '/oidc/token') {
          const tokens = {
            access_token: 'access-token',
            expires_in: 3600,
            refresh_token: 'refresh-token',
          };
          return Promise.resolve({
            clone: () => ({ json: () => Promise.resolve(tokens) }),
            ok: true,
            status: 200,
          });
        }

        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
      });
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      authCtr.cleanup();
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('times out a stalled remote configuration preflight before opening the browser', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const authorization = authCtr.requestAuthorization(cloudConfig);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(authorization).resolves.toEqual({
        error: 'Timed out after 10 seconds while verifying the remote server OIDC configuration',
        success: false,
      });
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it.each([
      ['success JSON', true],
      ['error text', false],
    ])('times out when the preflight %s body never completes', async (_label, ok) => {
      mockFetch.mockResolvedValue({
        json: () => new Promise(() => {}),
        ok,
        status: ok ? 200 : 503,
        statusText: ok ? 'OK' : 'Service Unavailable',
        text: () => new Promise(() => {}),
      });

      const authorization = authCtr.requestAuthorization(cloudConfig);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(authorization).resolves.toEqual({
        error: 'Timed out after 10 seconds while verifying the remote server OIDC configuration',
        success: false,
      });
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('cancels while the remote configuration preflight is still pending', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const authorization = authCtr.requestAuthorization(cloudConfig);
      await vi.advanceTimersByTimeAsync(0);

      await expect(authCtr.cancelAuthorization()).resolves.toEqual({ success: true });
      await expect(authorization).resolves.toEqual({
        error: 'Authorization request was cancelled or superseded',
        success: false,
      });
      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'authorizationProgress',
        expect.objectContaining({ phase: 'cancelled' }),
      );
    });

    it('does not let a superseded preflight open the old server', async () => {
      const oldPreflight = createDeferred<{
        json: () => Promise<{ appUrl: string }>;
        ok: boolean;
        status: number;
      }>();

      mockFetch.mockImplementation((url: string) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/api/desktop/auth-config') {
          if (parsed.origin === 'https://masterino.bielcrystal.com') {
            return oldPreflight.promise;
          }

          return Promise.resolve({
            json: () => Promise.resolve({ appUrl: 'https://new-self-host.example.com' }),
            ok: true,
            status: 200,
          });
        }

        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
      });

      const oldAuthorization = authCtr.requestAuthorization(cloudConfig);
      await vi.advanceTimersByTimeAsync(0);
      const newAuthorization = await authCtr.requestAuthorization({
        active: false,
        remoteServerUrl: 'https://new-self-host.example.com',
        storageMode: 'selfHost',
      });

      oldPreflight.resolve({
        json: () => Promise.resolve({ appUrl: 'https://masterino.bielcrystal.com' }),
        ok: true,
        status: 200,
      });

      expect(newAuthorization).toEqual({ success: true });
      await expect(oldAuthorization).resolves.toEqual({
        error: 'Authorization request was cancelled or superseded',
        success: false,
      });
      expect(shell.openExternal).toHaveBeenCalledTimes(1);
      expect(shell.openExternal).toHaveBeenCalledWith(
        expect.stringContaining('https://new-self-host.example.com/oidc/auth'),
      );
    });

    it('does not save tokens when authorization is cancelled during token exchange', async () => {
      const tokenResponse = createDeferred<{
        clone: () => { json: () => Promise<Record<string, unknown>> };
        ok: boolean;
        status: number;
      }>();

      mockFetch.mockImplementation((url: string) => {
        const pathname = new URL(url).pathname;
        if (pathname === '/api/desktop/auth-config') {
          return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
        }
        if (pathname === '/oidc/handoff') {
          return Promise.resolve({
            json: () =>
              Promise.resolve({
                data: { payload: { code: 'old-code', state: 'lobehub.mock-random-2' } },
                success: true,
              }),
            ok: true,
            status: 200,
          });
        }
        if (pathname === '/oidc/token') return tokenResponse.promise;

        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
      });

      await authCtr.requestAuthorization(cloudConfig);
      await vi.advanceTimersByTimeAsync(3000);
      await authCtr.cancelAuthorization();

      const tokens = {
        access_token: 'stale-access-token',
        expires_in: 3600,
        refresh_token: 'stale-refresh-token',
      };
      tokenResponse.resolve({
        clone: () => ({ json: () => Promise.resolve(tokens) }),
        ok: true,
        status: 200,
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(mockRemoteServerConfigCtr.saveTokens).not.toHaveBeenCalled();
      expect(mockRemoteServerConfigCtr.activateRemoteServerForOrigin).not.toHaveBeenCalled();
      expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('authorizationSuccessful');
    });

    it('rolls back an old token commit before starting a cross-server retry', async () => {
      const tokenSave = createDeferred<void>();
      vi.mocked(mockRemoteServerConfigCtr.saveTokens).mockImplementationOnce(
        () => tokenSave.promise,
      );

      mockFetch.mockImplementation((url: string) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/api/desktop/auth-config') {
          if (parsed.origin === 'https://new-self-host.example.com') {
            return Promise.resolve({
              json: () => Promise.resolve({ appUrl: parsed.origin }),
              ok: true,
              status: 200,
            });
          }
          return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
        }
        if (
          parsed.origin === 'https://masterino.bielcrystal.com' &&
          parsed.pathname === '/oidc/handoff'
        ) {
          return Promise.resolve({
            json: () =>
              Promise.resolve({
                data: { payload: { code: 'old-code', state: 'lobehub.mock-random-2' } },
                success: true,
              }),
            ok: true,
            status: 200,
          });
        }
        if (
          parsed.origin === 'https://masterino.bielcrystal.com' &&
          parsed.pathname === '/oidc/token'
        ) {
          const tokens = {
            access_token: 'old-access-token',
            expires_in: 3600,
            refresh_token: 'old-refresh-token',
          };
          return Promise.resolve({
            clone: () => ({ json: () => Promise.resolve(tokens) }),
            ok: true,
            status: 200,
          });
        }

        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
      });

      await authCtr.requestAuthorization(cloudConfig);
      await vi.advanceTimersByTimeAsync(3000);
      expect(mockRemoteServerConfigCtr.saveTokens).toHaveBeenCalledTimes(1);

      const retry = authCtr.requestAuthorization({
        active: false,
        remoteServerUrl: 'https://new-self-host.example.com',
        storageMode: 'selfHost',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(shell.openExternal).toHaveBeenCalledTimes(1);

      tokenSave.resolve();
      await vi.advanceTimersByTimeAsync(0);

      await expect(retry).resolves.toEqual({ success: true });
      expect(mockRemoteServerConfigCtr.clearTokens).toHaveBeenCalled();
      expect(mockRemoteServerConfigCtr.setRemoteServerConfig).toHaveBeenCalledWith({
        active: false,
      });
      expect(mockRemoteServerConfigCtr.activateRemoteServerForOrigin).not.toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenLastCalledWith(
        expect.stringContaining('https://new-self-host.example.com/oidc/auth'),
      );
    });

    it('does not persist or activate tokens when the configured origin no longer matches', async () => {
      mockSuccessfulCloudHandoffAndToken();
      vi.mocked(mockRemoteServerConfigCtr.isRemoteServerOriginCurrent).mockReturnValue(false);

      await authCtr.requestAuthorization(cloudConfig);
      await vi.advanceTimersByTimeAsync(3000);

      expect(mockRemoteServerConfigCtr.isRemoteServerOriginCurrent).toHaveBeenCalledWith(
        'https://masterino.bielcrystal.com',
      );
      expect(mockRemoteServerConfigCtr.saveTokens).not.toHaveBeenCalled();
      expect(mockRemoteServerConfigCtr.activateRemoteServerForOrigin).not.toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
        error: 'Remote server changed before exchanged tokens could be saved',
      });
    });

    it('rolls back when the origin changes immediately after the pre-save check', async () => {
      let originCurrent = true;
      mockSuccessfulCloudHandoffAndToken();
      vi.mocked(mockRemoteServerConfigCtr.isRemoteServerOriginCurrent).mockImplementation(
        () => originCurrent,
      );
      vi.mocked(mockRemoteServerConfigCtr.activateRemoteServerForOrigin).mockImplementation(
        () => originCurrent,
      );
      vi.mocked(mockRemoteServerConfigCtr.saveTokens).mockImplementationOnce(async () => {
        // Model a second IPC switching the target while encrypted persistence is in progress.
        originCurrent = false;
      });

      await authCtr.requestAuthorization(cloudConfig);
      await vi.advanceTimersByTimeAsync(3000);

      expect(mockRemoteServerConfigCtr.saveTokens).toHaveBeenCalledTimes(1);
      expect(mockRemoteServerConfigCtr.activateRemoteServerForOrigin).toHaveBeenCalledWith(
        'https://masterino.bielcrystal.com',
      );
      expect(mockRemoteServerConfigCtr.clearTokens).toHaveBeenCalled();
      expect(mockRemoteServerConfigCtr.setRemoteServerConfig).toHaveBeenCalledWith({
        active: false,
      });
      expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('authorizationSuccessful');
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
        error: 'Remote server changed before exchanged tokens could be activated',
      });
    });

    it('fails a new attempt safely when rollback of the previous token commit fails', async () => {
      const tokenSave = createDeferred<void>();
      mockSuccessfulCloudHandoffAndToken();
      vi.mocked(mockRemoteServerConfigCtr.saveTokens).mockImplementationOnce(
        () => tokenSave.promise,
      );
      vi.mocked(mockRemoteServerConfigCtr.clearTokens).mockRejectedValueOnce(
        new Error('encrypted token delete failed'),
      );

      await authCtr.requestAuthorization(cloudConfig);
      await vi.advanceTimersByTimeAsync(3000);
      expect(mockRemoteServerConfigCtr.saveTokens).toHaveBeenCalledTimes(1);

      const retry = authCtr.requestAuthorization({
        active: false,
        remoteServerUrl: 'https://new-self-host.example.com',
        storageMode: 'selfHost',
      });
      await vi.advanceTimersByTimeAsync(0);
      tokenSave.resolve();
      await vi.advanceTimersByTimeAsync(0);

      await expect(retry).resolves.toEqual({
        error:
          'Unable to safely start authorization because cleanup from the previous token commit failed: Failed to roll back authorization tokens: encrypted token delete failed',
        success: false,
      });
      expect(shell.openExternal).toHaveBeenCalledTimes(1);
      expect(mockRemoteServerConfigCtr.activateRemoteServerForOrigin).not.toHaveBeenCalled();
    });
  });

  describe('Handoff polling error handling', () => {
    const config: DataSyncConfig = {
      active: false,
      storageMode: 'cloud',
    };

    const getHandoffCalls = () =>
      mockFetch.mock.calls.filter((call) => (call[0] as string).includes('/oidc/handoff'));

    const mockHandoffFetch = (handler: (url: string) => Promise<unknown>) => {
      mockFetch.mockImplementation((url: string) => {
        if (new URL(url).pathname === '/api/desktop/auth-config') {
          return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
        }

        return handler(url);
      });
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      authCtr.cleanup();
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('advertises and enforces a five-minute polling window', async () => {
      mockHandoffFetch(() => Promise.reject(new Error('socket hang up')));

      await authCtr.requestAuthorization(config);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'authorizationProgress',
        expect.objectContaining({ maxPollTime: 5 * 60 * 1000 }),
      );

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
        error: expect.stringContaining('Authorization timed out'),
      });
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
        error: expect.stringContaining('socket hang up'),
      });
    });

    it('keeps polling when the handoff is not ready yet', async () => {
      mockHandoffFetch(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        }),
      );

      await authCtr.requestAuthorization(config);
      await vi.advanceTimersByTimeAsync(2 * 3000);

      expect(getHandoffCalls()).toHaveLength(2);
      expect(mockWindow.webContents.send).not.toHaveBeenCalledWith(
        'authorizationFailed',
        expect.anything(),
      );
    });

    it('fails immediately when a successful HTTP response has no handoff payload', async () => {
      mockHandoffFetch(() =>
        Promise.resolve({
          json: () => Promise.resolve({ success: false }),
          ok: true,
          status: 200,
        }),
      );

      await authCtr.requestAuthorization(config);
      await vi.advanceTimersByTimeAsync(3000);

      expect(getHandoffCalls()).toHaveLength(1);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
        error: 'Invalid handoff response: expected a successful payload containing code and state',
      });

      await vi.advanceTimersByTimeAsync(3000);
      expect(getHandoffCalls()).toHaveLength(1);
    });

    it.each([
      [400, 'Bad Request', 'invalid handoff id'],
      [401, 'Unauthorized', 'handoff authentication required'],
      [403, 'Forbidden', 'handoff access denied'],
    ])(
      'fails immediately for deterministic HTTP %i responses and keeps the server reason',
      async (status, statusText, reason) => {
        mockHandoffFetch(() =>
          Promise.resolve({
            ok: false,
            status,
            statusText,
            text: vi.fn().mockResolvedValue(JSON.stringify({ error: reason })),
          }),
        );

        await authCtr.requestAuthorization(config);
        await vi.advanceTimersByTimeAsync(3000);

        expect(getHandoffCalls()).toHaveLength(1);
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
          error: `HTTP ${status} ${statusText}: ${reason}`,
        });

        await vi.advanceTimersByTimeAsync(3000);
        expect(getHandoffCalls()).toHaveLength(1);
      },
    );

    it('retries network errors without failing the authorization early', async () => {
      mockHandoffFetch(() => Promise.reject(new Error('ECONNRESET')));

      await authCtr.requestAuthorization(config);
      await vi.advanceTimersByTimeAsync(3 * 3000);

      expect(getHandoffCalls()).toHaveLength(3);
      expect(mockWindow.webContents.send).not.toHaveBeenCalledWith(
        'authorizationFailed',
        expect.anything(),
      );
    });

    it.each([
      [429, 'Too Many Requests'],
      [500, 'Internal Server Error'],
      [503, 'Service Unavailable'],
    ])('retries transient HTTP %i responses', async (status, statusText) => {
      mockHandoffFetch(() =>
        Promise.resolve({
          ok: false,
          status,
          statusText,
          text: vi.fn().mockResolvedValue('temporary upstream failure'),
        }),
      );

      await authCtr.requestAuthorization(config);
      await vi.advanceTimersByTimeAsync(2 * 3000);

      expect(getHandoffCalls()).toHaveLength(2);
      expect(mockWindow.webContents.send).not.toHaveBeenCalledWith(
        'authorizationFailed',
        expect.anything(),
      );
    });

    it('retries a transient response whose body times out and preserves the HTTP reason', async () => {
      mockHandoffFetch(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: vi.fn(() => new Promise(() => {})),
        }),
      );

      await authCtr.requestAuthorization(config);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(getHandoffCalls().length).toBeGreaterThan(1);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
        error: expect.stringContaining('HTTP 503 Service Unavailable'),
      });
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
        error: expect.stringContaining('timed out after 15 seconds'),
      });
    });

    it('fails explicitly when a successful handoff response body times out', async () => {
      mockHandoffFetch(() =>
        Promise.resolve({
          json: vi.fn(() => new Promise(() => {})),
          ok: true,
          status: 200,
          statusText: 'OK',
        }),
      );

      await authCtr.requestAuthorization(config);
      await vi.advanceTimersByTimeAsync(3_000 + 15_001);

      expect(getHandoffCalls()).toHaveLength(1);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
        error: 'Timed out after 15 seconds while reading the successful HTTP 200 handoff response',
      });
    });

    it('times out at five minutes even if a handoff request is still pending', async () => {
      mockHandoffFetch(() => new Promise(() => {}));

      await authCtr.requestAuthorization(config);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(getHandoffCalls().length).toBeGreaterThan(1);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
        error: expect.stringContaining(
          'Timed out after 15 seconds while polling authorization handoff',
        ),
      });
    });
  });

  describe('PKCE handoff token exchange', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      authCtr.cleanup();
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('exchanges the handoff code with the original verifier and redirect URI', async () => {
      let tokenRequestBody = '';

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        const pathname = new URL(url).pathname;

        if (pathname === '/api/desktop/auth-config') {
          return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
        }

        if (pathname === '/oidc/handoff') {
          return Promise.resolve({
            json: () =>
              Promise.resolve({
                data: {
                  payload: { code: 'handoff-code', state: 'lobehub.mock-random-2' },
                },
                success: true,
              }),
            ok: true,
            status: 200,
          });
        }

        if (pathname === '/oidc/token') {
          tokenRequestBody = String(init?.body ?? '');
          const tokenResponse = {
            access_token: 'access-token',
            expires_in: 3600,
            refresh_token: 'refresh-token',
          };

          return Promise.resolve({
            clone: () => ({ json: () => Promise.resolve(tokenResponse) }),
            json: () => Promise.resolve(tokenResponse),
            ok: true,
            status: 200,
          });
        }

        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
      });

      await authCtr.requestAuthorization({ active: false, storageMode: 'cloud' });
      await vi.advanceTimersByTimeAsync(3000);

      const tokenParams = new URLSearchParams(tokenRequestBody);
      expect(tokenParams.get('client_id')).toBe('lobehub-desktop');
      expect(tokenParams.get('code')).toBe('handoff-code');
      expect(tokenParams.get('code_verifier')).toBe('mock-random-1');
      expect(tokenParams.get('grant_type')).toBe('authorization_code');
      expect(tokenParams.get('redirect_uri')).toBe(
        'https://masterino.bielcrystal.com/oidc/callback/desktop',
      );
      expect(mockRemoteServerConfigCtr.saveTokens).toHaveBeenCalledWith(
        'access-token',
        'refresh-token',
        3600,
      );
    });

    it.each(['fetch', 'success body', 'error body'])(
      'fails with the real timeout when the token exchange %s stalls',
      async (stalledPhase) => {
        mockFetch.mockImplementation((url: string) => {
          const pathname = new URL(url).pathname;

          if (pathname === '/api/desktop/auth-config') {
            return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
          }
          if (pathname === '/oidc/handoff') {
            return Promise.resolve({
              json: () =>
                Promise.resolve({
                  data: { payload: { code: 'handoff-code', state: 'lobehub.mock-random-2' } },
                  success: true,
                }),
              ok: true,
              status: 200,
            });
          }
          if (pathname === '/oidc/token') {
            if (stalledPhase === 'fetch') return new Promise(() => {});
            if (stalledPhase === 'error body') {
              return Promise.resolve({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                text: () => new Promise(() => {}),
              });
            }

            return Promise.resolve({
              clone: () => ({ json: () => new Promise(() => {}) }),
              ok: true,
              status: 200,
            });
          }

          return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
        });

        await authCtr.requestAuthorization({ active: false, storageMode: 'cloud' });
        await vi.advanceTimersByTimeAsync(3_000 + 30_001);

        expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
          error: 'Timed out after 30 seconds while exchanging authorization code for token',
        });
        expect(mockRemoteServerConfigCtr.saveTokens).not.toHaveBeenCalled();
      },
    );
  });

  describe('Scenario: Authorization Timeout and Retry', () => {
    // All scenario tests use real timers

    it('Step 1: User requests authorization but does not complete it within 5 minutes', async () => {
      const config: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };

      // Mock: User never completes authorization, so polling always returns 404
      mockFetch.mockResolvedValue({
        status: 404,
        ok: false,
      });

      // User clicks "Connect to Cloud" button
      await authCtr.requestAuthorization(config);

      // Wait for some polling to happen
      await new Promise((resolve) => setTimeout(resolve, 10000));

      const handoffCallsBeforeTimeout = mockFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('/oidc/handoff'),
      ).length;
      expect(handoffCallsBeforeTimeout).toBeGreaterThan(0);

      // Verify polling is active by checking calls increased
      const callsBefore = handoffCallsBeforeTimeout;
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const callsAfter = mockFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('/oidc/handoff'),
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    }, 15000); // Increase test timeout

    it('Step 2: User clicks retry button after previous attempt', async () => {
      const config: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };

      mockFetch.mockResolvedValue({
        status: 404,
        ok: false,
      });

      // First attempt
      await authCtr.requestAuthorization(config);
      await new Promise((resolve) => setTimeout(resolve, 3500));

      // Reset mock to track retry
      mockFetch.mockClear();

      // User clicks retry button - should start fresh authorization
      await authCtr.requestAuthorization(config);

      // Verify: New polling started
      await new Promise((resolve) => setTimeout(resolve, 3500));

      const handoffCalls = mockFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('/oidc/handoff'),
      );
      expect(handoffCalls.length).toBeGreaterThan(0);
    }, 10000);

    it('Step 3: Retry generates new state parameter (not reusing old state)', async () => {
      const config: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };

      const capturedStates: string[] = [];

      mockFetch.mockImplementation((url: string) => {
        const urlObj = new URL(url);
        const stateParam = urlObj.searchParams.get('id');
        if (stateParam && !capturedStates.includes(stateParam)) {
          capturedStates.push(stateParam);
        }
        return Promise.resolve({ status: 404, ok: false });
      });

      // First authorization attempt
      await authCtr.requestAuthorization(config);
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const firstState = capturedStates[0];

      // Clear for second attempt tracking
      const firstAttemptStates = [...capturedStates];
      capturedStates.length = 0;

      // Retry - should generate NEW state
      await authCtr.requestAuthorization(config);
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const secondState = capturedStates[0];

      // CRITICAL: States must be different
      expect(firstState).toBeDefined();
      expect(secondState).toBeDefined();
      expect(secondState).not.toBe(firstState);
      expect(firstAttemptStates).not.toContain(secondState);
    }, 10000);

    it('Step 4: User completes authorization on retry successfully', async () => {
      const config: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };

      // First attempt - incomplete
      mockFetch.mockResolvedValue({ status: 404, ok: false });
      await authCtr.requestAuthorization(config);
      await new Promise((resolve) => setTimeout(resolve, 3500));

      // Second attempt - user completes it this time
      mockFetch.mockImplementation((url: string) => {
        const urlObj = new URL(url);

        // Handoff returns credentials immediately
        if (urlObj.pathname.includes('/oidc/handoff')) {
          return Promise.resolve({
            status: 200,
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  payload: {
                    code: 'authorization-code',
                    state: 'lobehub.mock-random-4', // Matches second request's state (3rd and 4th randomBytes calls)
                  },
                },
              }),
            text: () => Promise.resolve('mock response'),
          });
        }

        // Token exchange succeeds
        if (urlObj.pathname.includes('/oidc/token')) {
          return Promise.resolve({
            status: 200,
            ok: true,
            json: () =>
              Promise.resolve({
                access_token: 'access-token',
                refresh_token: 'refresh-token',
                expires_in: 3600,
              }),
            text: () => Promise.resolve('mock response'),
            clone: () => ({
              json: () =>
                Promise.resolve({
                  access_token: 'access-token',
                  refresh_token: 'refresh-token',
                  expires_in: 3600,
                }),
            }),
          });
        }

        return Promise.resolve({ status: 404, ok: false });
      });

      await authCtr.requestAuthorization(config);

      // Wait longer for polling and token exchange
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Verify: Success message shown
      const successCall = mockWindow.webContents.send.mock.calls.find(
        (call: any[]) => call[0] === 'authorizationSuccessful',
      );
      expect(successCall).toBeDefined();

      // Verify: Tokens saved
      expect(mockRemoteServerConfigCtr.saveTokens).toHaveBeenCalled();
    }, 12000);

    it('Edge case: Rapid retry clicks should not create multiple polling intervals', async () => {
      const config: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };

      mockFetch.mockResolvedValue({ status: 404, ok: false });

      // User rapidly clicks retry multiple times
      await authCtr.requestAuthorization(config);
      await authCtr.requestAuthorization(config);
      await authCtr.requestAuthorization(config);

      // Wait for some polling to happen
      await new Promise((resolve) => setTimeout(resolve, 9000));

      // Count handoff requests
      const handoffCalls = mockFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('/oidc/handoff'),
      );

      // Should have ~3 calls (one per 3-second interval), not ~9 (3 intervals running)
      // Allow some tolerance for timing
      expect(handoffCalls.length).toBeLessThanOrEqual(5);
    }, 10000);
  });

  describe('Proactive Token Refresh', () => {
    beforeEach(() => {
      vi.mocked(mockRemoteServerConfigCtr.getRemoteServerConfig).mockResolvedValue({
        active: true,
        remoteServerUrl: 'https://masterino.bielcrystal.com',
        storageMode: 'cloud',
      });
      vi.mocked(mockRemoteServerConfigCtr.isRemoteServerConfigured).mockResolvedValue(true);
      vi.mocked(mockRemoteServerConfigCtr.getAccessToken).mockResolvedValue('mock-access-token');
      vi.mocked(mockRemoteServerConfigCtr.getTokenExpiresAt).mockReturnValue(
        Date.now() + 7 * 24 * 60 * 60 * 1000, // Token valid for 7 days
      );
      vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(false);
      vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValue({ success: true });
      vi.mocked(mockRemoteServerConfigCtr.isNonRetryableError).mockReturnValue(false);
    });

    describe('onAppActivate', () => {
      it('should refresh token when it is expiring soon', async () => {
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(true);

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).toHaveBeenCalled();
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('tokenRefreshed');
      });

      it('should NOT refresh token when it is not expiring soon', async () => {
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(false);

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).not.toHaveBeenCalled();
      });

      it('should check expiry with a small buffer, not the 24h default', async () => {
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(false);

        await authCtr.onAppActivate();

        const [buffer] = vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mock.calls[0];
        expect(buffer).toBeGreaterThan(0);
        expect(buffer).toBeLessThanOrEqual(60 * 60 * 1000);
      });

      it('should skip refresh when remote server is not active', async () => {
        vi.mocked(mockRemoteServerConfigCtr.isRemoteServerConfigured).mockResolvedValue(false);
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(true);

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).not.toHaveBeenCalled();
      });

      it('should skip refresh when no access token exists', async () => {
        vi.mocked(mockRemoteServerConfigCtr.getAccessToken).mockResolvedValue(null);
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(true);

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).not.toHaveBeenCalled();
      });

      it('should clear tokens and require re-auth on non-retryable error', async () => {
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(true);
        vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValue({
          error: 'invalid_grant',
          success: false,
        });
        vi.mocked(mockRemoteServerConfigCtr.isNonRetryableError).mockReturnValue(true);

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.clearTokens).toHaveBeenCalled();
        expect(mockRemoteServerConfigCtr.setRemoteServerConfig).toHaveBeenCalledWith({
          active: false,
        });
        expect(mockWindow.webContents.send).toHaveBeenCalledWith(
          'authorizationRequired',
          expect.objectContaining({
            reason: expect.stringContaining('startup:non_retryable'),
          }),
        );
      });

      it('should preserve tokens on transient error', async () => {
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(true);
        vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValue({
          error: 'network_error',
          success: false,
        });
        vi.mocked(mockRemoteServerConfigCtr.isNonRetryableError).mockReturnValue(false);

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.clearTokens).not.toHaveBeenCalled();
      });
    });

    describe('afterAppReady (initializeAutoRefresh)', () => {
      it('should proactively refresh on startup when token is expiring soon', async () => {
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(true);

        authCtr.afterAppReady();
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockRemoteServerConfigCtr.refreshAccessToken).toHaveBeenCalled();
      });

      it('should NOT refresh on startup when token is not expiring soon', async () => {
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(false);

        authCtr.afterAppReady();
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockRemoteServerConfigCtr.refreshAccessToken).not.toHaveBeenCalled();
      });

      it('should check expiry with a small buffer, not the 24h default', async () => {
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(false);

        authCtr.afterAppReady();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const [buffer] = vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mock.calls[0];
        expect(buffer).toBeGreaterThan(0);
        expect(buffer).toBeLessThanOrEqual(60 * 60 * 1000);
      });

      it('should skip initialization when no access token exists', async () => {
        vi.mocked(mockRemoteServerConfigCtr.getAccessToken).mockResolvedValue(null);
        vi.mocked(mockRemoteServerConfigCtr.isTokenExpiringSoon).mockReturnValue(true);

        authCtr.afterAppReady();
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockRemoteServerConfigCtr.refreshAccessToken).not.toHaveBeenCalled();
      });
    });
  });
});
