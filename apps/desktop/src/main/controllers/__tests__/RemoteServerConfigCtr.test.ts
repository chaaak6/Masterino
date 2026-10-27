import type { DataSyncConfig } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import RemoteServerConfigCtr from '../RemoteServerConfigCtr';

const {
  ipcMainHandleMock,
  mockFetch,
  mockFromPartition,
  mockLoggerError,
  mockLoggerWarn,
  mockOnBeforeSendHeaders,
} = vi.hoisted(() => {
  const mockOnBeforeSendHeaders = vi.fn();

  return {
    ipcMainHandleMock: vi.fn(),
    mockFetch: vi.fn(),
    mockFromPartition: vi.fn(() => ({
      webRequest: { onBeforeSendHeaders: mockOnBeforeSendHeaders },
    })),
    mockLoggerError: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockOnBeforeSendHeaders,
  };
});

const auth = vi.hoisted(() => ({ record: undefined as any, write: vi.fn(), clear: vi.fn() }));
vi.mock('@/modules/authStorage', () => ({
  AuthStorage: class {
    read() {
      return auth.record;
    }
    write(value: unknown) {
      auth.write(value);
      auth.record = value;
    }
    clear() {
      auth.clear();
      auth.record = undefined;
    }
  },
}));

vi.mock('@/utils/net-fetch', () => ({
  netFetch: mockFetch,
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: mockLoggerError,
    info: vi.fn(),
    warn: mockLoggerWarn,
  }),
}));

// Keep controller tests isolated from gateway workspace-package dependencies.
vi.mock('@/services/gatewayConnectionSrv', () => ({
  default: class GatewayConnectionService {},
}));

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
  safeStorage: {
    decryptString: vi.fn((buffer: Buffer) => buffer.toString()),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    getSelectedStorageBackend: vi.fn(() => 'kwallet6'),
    isEncryptionAvailable: vi.fn(() => true),
  },
  session: {
    fromPartition: mockFromPartition,
  },
}));

// Mock @/const/env
vi.mock('@/const/env', () => ({
  OFFICIAL_CLOUD_SERVER: 'https://masterino.bielcrystal.com',
}));

// Mock storeManager
const mockStoreManager = {
  delete: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
};

const mockBrowserManager = {
  broadcastToAllWindows: vi.fn(),
};

const mockGatewayConnectionSrv = {
  disconnect: vi.fn().mockResolvedValue({ success: true }),
};

const mockApp = {
  browserManager: mockBrowserManager,
  getController: vi.fn(),
  getService: vi.fn().mockReturnValue(mockGatewayConnectionSrv),
  storeManager: mockStoreManager,
} as unknown as App;

describe('RemoteServerConfigCtr', () => {
  let controller: RemoteServerConfigCtr;

  beforeEach(async () => {
    vi.clearAllMocks();
    auth.record = undefined;
    auth.write.mockReset();
    ipcMainHandleMock.mockClear();
    const { safeStorage } = await import('electron');
    const getSelectedStorageBackend = (
      safeStorage as typeof safeStorage & { getSelectedStorageBackend: () => string }
    ).getSelectedStorageBackend;
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    vi.mocked(getSelectedStorageBackend).mockReturnValue('kwallet6');
    vi.mocked(safeStorage.encryptString).mockImplementation((value: string) => Buffer.from(value));
    vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) => buffer.toString());
    mockStoreManager.get.mockReturnValue({
      active: false,
      storageMode: 'cloud',
    });
    controller = new RemoteServerConfigCtr(mockApp);
  });

  describe('getRemoteServerConfig', () => {
    it('should return stored configuration', async () => {
      const config: DataSyncConfig = {
        active: true,
        remoteServerUrl: 'https://my-server.com',
        storageMode: 'selfHost',
      };
      mockStoreManager.get.mockReturnValue(config);

      const result = await controller.getRemoteServerConfig();

      expect(result).toEqual(config);
      expect(mockStoreManager.get).toHaveBeenCalledWith('dataSyncConfig');
    });
  });

  describe('setRemoteServerConfig', () => {
    it('should update configuration', async () => {
      const prevConfig: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };
      mockStoreManager.get.mockReturnValue(prevConfig);

      const newConfig: Partial<DataSyncConfig> = {
        active: true,
        remoteServerUrl: 'https://my-server.com',
        storageMode: 'selfHost',
      };

      const result = await controller.setRemoteServerConfig(newConfig);

      expect(result).toBe(true);
      expect(mockStoreManager.set).toHaveBeenCalledWith('dataSyncConfig', {
        ...prevConfig,
        ...newConfig,
      });
    });

    it('should clear tokens before switching to a different server origin', async () => {
      await controller.saveTokens('server-a-access', 'server-a-refresh', 3600);
      vi.clearAllMocks();
      mockStoreManager.get.mockReturnValue({
        active: true,
        remoteServerUrl: 'https://server-a.example.com',
        storageMode: 'selfHost',
      });

      await controller.setRemoteServerConfig({
        active: false,
        remoteServerUrl: 'https://server-b.example.com',
        storageMode: 'selfHost',
      });

      expect(mockStoreManager.delete).toHaveBeenCalledWith('encryptedTokens');
      expect(mockGatewayConnectionSrv.disconnect).toHaveBeenCalled();
      expect(mockStoreManager.set).toHaveBeenCalledWith('dataSyncConfig', {
        active: false,
        remoteServerUrl: 'https://server-b.example.com',
        storageMode: 'selfHost',
      });
    });

    it('should preserve newly exchanged tokens when activating the same server', async () => {
      mockStoreManager.get.mockReturnValue({
        active: false,
        remoteServerUrl: 'https://server-b.example.com',
        storageMode: 'selfHost',
      });
      await controller.saveTokens('server-b-access', 'server-b-refresh', 3600);
      vi.clearAllMocks();

      await controller.setRemoteServerConfig({ active: true });

      expect(mockStoreManager.delete).not.toHaveBeenCalled();
      await expect(controller.getAccessToken()).resolves.toBe('server-b-access');
    });

    it('should atomically activate only the origin that is still configured', () => {
      mockStoreManager.get.mockReturnValue({
        active: false,
        remoteServerUrl: 'https://server-b.example.com/base',
        storageMode: 'selfHost',
      });

      expect(controller.isRemoteServerOriginCurrent('https://server-a.example.com')).toBe(false);
      expect(controller.activateRemoteServerForOrigin('https://server-a.example.com')).toBe(false);
      expect(mockStoreManager.set).not.toHaveBeenCalled();

      expect(controller.isRemoteServerOriginCurrent('https://server-b.example.com/oidc')).toBe(
        true,
      );
      expect(controller.activateRemoteServerForOrigin('https://server-b.example.com/oidc')).toBe(
        true,
      );
      expect(mockStoreManager.set).toHaveBeenCalledWith('dataSyncConfig', {
        active: true,
        remoteServerUrl: 'https://server-b.example.com/base',
        storageMode: 'selfHost',
      });
      expect(mockApp.browserManager.broadcastToAllWindows).toHaveBeenCalledWith(
        'remoteServerConfigUpdated',
        undefined,
      );
    });
  });

  describe('clearRemoteServerConfig', () => {
    it('should clear configuration and tokens', async () => {
      const result = await controller.clearRemoteServerConfig();

      expect(result).toBe(true);
      expect(mockStoreManager.set).toHaveBeenCalledWith('dataSyncConfig', {
        active: false,
        storageMode: 'cloud',
      });
      expect(mockStoreManager.delete).toHaveBeenCalledWith('encryptedTokens');
    });
  });

  describe('plaintext credentials', () => {
    it.each(['darwin', 'win32'])(
      'migrates legacy credentials without touching macOS Keychain (%s)',
      async (platform) => {
        const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
        const { safeStorage } = await import('electron');
        const legacy = {
          accessToken: Buffer.from('old-access').toString('base64'),
          refreshToken: Buffer.from('old-refresh').toString('base64'),
          issuerOrigin: 'https://masterino.bielcrystal.com',
          expiresAt: Date.now() + 3600000,
        };
        mockStoreManager.get.mockImplementation((key: string) =>
          key === 'encryptedTokens' ? legacy : { active: true, storageMode: 'cloud' },
        );
        try {
          Object.defineProperty(process, 'platform', { value: platform });
          controller = new RemoteServerConfigCtr(mockApp);
          const token = await controller.getAccessToken();
          if (platform === 'win32') {
            expect(token).toBe('old-access');
            expect(auth.write).toHaveBeenCalledWith(
              expect.objectContaining({ accessToken: 'old-access', refreshToken: 'old-refresh' }),
            );
            expect(mockStoreManager.delete).toHaveBeenCalledWith('encryptedTokens');
          } else {
            expect(token).toBeNull();
            expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
            expect(safeStorage.decryptString).not.toHaveBeenCalled();
            expect(mockStoreManager.delete).not.toHaveBeenCalledWith('encryptedTokens');
          }
        } finally {
          Object.defineProperty(process, 'platform', original);
        }
      },
    );

    it('persists both tokens and reuses them without OS encryption', async () => {
      const { safeStorage } = await import('electron');
      await controller.saveTokens('access', 'refresh', 3600);
      expect(auth.write).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'access',
          refreshToken: 'refresh',
          issuerOrigin: 'https://masterino.bielcrystal.com',
        }),
      );
      await expect(controller.getAccessToken()).resolves.toBe('access');
      await expect(controller.getRefreshToken()).resolves.toBe('refresh');
      expect(safeStorage.encryptString).not.toHaveBeenCalled();
      expect(safeStorage.decryptString).not.toHaveBeenCalled();
    });
    it('keeps previously committed credentials if a write fails', async () => {
      await controller.saveTokens('previous', 'previous-refresh');
      auth.write.mockImplementationOnce(() => {
        throw new Error('disk unavailable');
      });
      await expect(controller.saveTokens('new', 'new-refresh')).rejects.toThrow('disk unavailable');
      await expect(controller.getAccessToken()).resolves.toBe('previous');
    });
  });

  describe('clearTokens', () => {
    it('should clear all tokens from memory and store', async () => {
      await controller.saveTokens('access', 'refresh', 3600);
      await controller.clearTokens();

      expect(mockStoreManager.delete).toHaveBeenCalledWith('encryptedTokens');

      // Verify tokens are cleared from memory
      const accessToken = await controller.getAccessToken();
      expect(accessToken).toBeNull();
    });

    it('should disconnect gateway when tokens are cleared', async () => {
      await controller.saveTokens('access', 'refresh', 3600);
      await controller.clearTokens();

      expect(mockGatewayConnectionSrv.disconnect).toHaveBeenCalled();
    });
  });

  describe('getTokenExpiresAt', () => {
    it('should return expiration time after saving tokens with expiration', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      const beforeSave = Date.now();
      await controller.saveTokens('access', 'refresh', 3600);
      const afterSave = Date.now();

      const expiresAt = controller.getTokenExpiresAt();

      expect(expiresAt).toBeDefined();
      expect(expiresAt).toBeGreaterThanOrEqual(beforeSave + 3600 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(afterSave + 3600 * 1000);
    });

    it('should return undefined when no expiration is set', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      await controller.saveTokens('access', 'refresh');

      const expiresAt = controller.getTokenExpiresAt();

      expect(expiresAt).toBeUndefined();
    });
  });

  describe('isTokenExpiringSoon', () => {
    it('should return false when no expiration is set', () => {
      const result = controller.isTokenExpiringSoon();

      expect(result).toBe(false);
    });

    it('should return false when token is not expiring soon', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      // Token expires in 2 days (well beyond the 24-hour default buffer)
      await controller.saveTokens('access', 'refresh', 2 * 24 * 3600);

      // Default buffer is 24 hours
      const result = controller.isTokenExpiringSoon();

      expect(result).toBe(false);
    });

    it('should return true when token is within buffer time', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      // Token expires in 2 minutes
      await controller.saveTokens('access', 'refresh', 120);

      // Default buffer is 5 minutes, so token is expiring soon
      const result = controller.isTokenExpiringSoon();

      expect(result).toBe(true);
    });

    it('should respect custom buffer time', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      // Token expires in 10 minutes
      await controller.saveTokens('access', 'refresh', 600);

      // With 15 minute buffer, should be expiring soon
      const result = controller.isTokenExpiringSoon(15 * 60 * 1000);

      expect(result).toBe(true);
    });
  });

  describe('isNonRetryableError', () => {
    it('should return false for null/undefined error', () => {
      expect(controller.isNonRetryableError(undefined)).toBe(false);
      expect(controller.isNonRetryableError('')).toBe(false);
    });

    it('should return true for OIDC error codes', () => {
      expect(controller.isNonRetryableError('invalid_grant')).toBe(true);
      expect(controller.isNonRetryableError('Token refresh failed: invalid_client')).toBe(true);
      expect(controller.isNonRetryableError('unauthorized_client error')).toBe(true);
      expect(controller.isNonRetryableError('access_denied by user')).toBe(true);
      expect(controller.isNonRetryableError('invalid_scope requested')).toBe(true);
    });

    it('should return true for deterministic failures', () => {
      expect(controller.isNonRetryableError('No refresh token available')).toBe(true);
      expect(controller.isNonRetryableError('Remote server is not active or configured')).toBe(
        true,
      );
      expect(controller.isNonRetryableError('Missing tokens in refresh response')).toBe(true);
    });

    it('should return false for transient/network errors', () => {
      expect(controller.isNonRetryableError('Network error')).toBe(false);
      expect(controller.isNonRetryableError('fetch failed')).toBe(false);
      expect(controller.isNonRetryableError('ETIMEDOUT')).toBe(false);
      expect(controller.isNonRetryableError('Connection refused')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(controller.isNonRetryableError('INVALID_GRANT')).toBe(true);
      expect(controller.isNonRetryableError('NO REFRESH TOKEN AVAILABLE')).toBe(true);
    });
  });

  describe('refreshAccessToken', () => {
    it('should return error when remote server is not active', async () => {
      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return { active: false, storageMode: 'cloud' };
        }
        return null;
      });

      const result = await controller.refreshAccessToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not active');
    });

    it('should return error when no refresh token available', async () => {
      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        if (key === 'encryptedTokens') {
          return null;
        }
        return null;
      });

      const newController = new RemoteServerConfigCtr(mockApp);
      const result = await newController.refreshAccessToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('No refresh token');
    });

    it('should refresh token successfully', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        return null;
      });

      // Save initial tokens
      await controller.saveTokens('old-access', 'old-refresh');

      mockFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            expires_in: 3600,
            refresh_token: 'new-refresh-token',
          }),
        ok: true,
      });

      const result = await controller.refreshAccessToken();

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://server.com/oidc/token',
        expect.objectContaining({
          body: expect.stringContaining('grant_type=refresh_token'),
          method: 'POST',
        }),
      );
    });

    it('should handle refresh failure', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        return null;
      });

      await controller.saveTokens('old-access', 'old-refresh');

      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ error: 'invalid_grant' }),
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      const result = await controller.refreshAccessToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token refresh failed');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle missing tokens in response', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        return null;
      });

      await controller.saveTokens('old-access', 'old-refresh');

      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ access_token: 'sensitive-partial-access-token' }),
        ok: true,
      });

      const result = await controller.refreshAccessToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing tokens');
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Refresh response missing access_token or refresh_token',
        { hasAccessToken: true, hasRefreshToken: false },
      );
      expect(JSON.stringify(mockLoggerError.mock.calls)).not.toContain(
        'sensitive-partial-access-token',
      );
    });

    it('should discard a late server A refresh after switching and logging in to server B', async () => {
      let currentConfig: DataSyncConfig = {
        active: true,
        remoteServerUrl: 'https://server-a.example.com',
        storageMode: 'selfHost',
      };
      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') return currentConfig;
        return null;
      });
      mockStoreManager.set.mockImplementation((key, value) => {
        if (key === 'dataSyncConfig') currentConfig = value;
      });

      await controller.saveTokens('server-a-access', 'server-a-refresh');

      let resolveServerAResponse: (response: unknown) => void;
      const serverAResponse = new Promise((resolve) => {
        resolveServerAResponse = resolve;
      });
      mockFetch.mockReturnValue(serverAResponse);

      const serverARefresh = controller.refreshAccessToken();
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      await controller.setRemoteServerConfig({
        active: false,
        remoteServerUrl: 'https://server-b.example.com',
        storageMode: 'selfHost',
      });
      await controller.saveTokens('server-b-access', 'server-b-refresh');
      await controller.setRemoteServerConfig({ active: true });

      resolveServerAResponse!({
        json: () =>
          Promise.resolve({
            access_token: 'late-server-a-access',
            expires_in: 3600,
            refresh_token: 'late-server-a-refresh',
          }),
        ok: true,
      });

      const result = await serverARefresh;

      expect(result).toEqual({
        error: 'Token refresh was superseded by a server or credential change',
        success: false,
      });
      await expect(controller.getAccessToken()).resolves.toBe('server-b-access');
      expect(currentConfig).toEqual({
        active: true,
        remoteServerUrl: 'https://server-b.example.com',
        storageMode: 'selfHost',
      });
      expect(JSON.stringify(mockStoreManager.set.mock.calls)).not.toContain('late-server-a-access');
    });

    it.each([
      {
        forbiddenError: 'invalid_grant',
        ok: false,
        payload: { error: 'invalid_grant' },
        status: 400,
        statusText: 'Bad Request',
      },
      {
        forbiddenError: 'Missing tokens',
        ok: true,
        payload: {},
        status: 200,
        statusText: 'OK',
      },
    ])(
      'should classify a stale parsed response as superseded instead of $forbiddenError',
      async ({ forbiddenError, ok, payload, status, statusText }) => {
        let currentConfig: DataSyncConfig = {
          active: true,
          remoteServerUrl: 'https://server-a.example.com',
          storageMode: 'selfHost',
        };
        mockStoreManager.get.mockImplementation((key) => {
          if (key === 'dataSyncConfig') return currentConfig;
          return null;
        });
        mockStoreManager.set.mockImplementation((key, value) => {
          if (key === 'dataSyncConfig') currentConfig = value;
        });
        await controller.saveTokens('server-a-access', 'server-a-refresh');

        let resolveParsedBody: (body: unknown) => void;
        const parsedBody = new Promise((resolve) => {
          resolveParsedBody = resolve;
        });
        const parseResponse = vi.fn(() => parsedBody);
        mockFetch.mockResolvedValue({ json: parseResponse, ok, status, statusText });

        const serverARefresh = controller.refreshAccessToken();
        await vi.waitFor(() => expect(parseResponse).toHaveBeenCalledOnce());

        await controller.setRemoteServerConfig({
          active: false,
          remoteServerUrl: 'https://server-b.example.com',
          storageMode: 'selfHost',
        });
        await controller.saveTokens('server-b-access', 'server-b-refresh');
        await controller.setRemoteServerConfig({ active: true });
        resolveParsedBody!(payload);

        const result = await serverARefresh;

        expect(result.error).toBe('Token refresh was superseded by a server or credential change');
        expect(result.error).not.toContain(forbiddenError);
        await expect(controller.getAccessToken()).resolves.toBe('server-b-access');
      },
    );

    it('should handle concurrent refresh requests by returning same result', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        return null;
      });

      await controller.saveTokens('old-access', 'old-refresh');

      let resolvePromise: (value: any) => void;
      const delayedResponse = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockFetch.mockReturnValue(delayedResponse);

      // Start two concurrent refresh requests
      const promise1 = controller.refreshAccessToken();
      const promise2 = controller.refreshAccessToken();

      // Resolve the fetch
      resolvePromise!({
        json: () =>
          Promise.resolve({
            access_token: 'new-access',
            expires_in: 3600,
            refresh_token: 'new-refresh',
          }),
        ok: true,
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Both results should be equal (same success)
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry after a network error', async () => {
      const { safeStorage } = await import('electron');
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.decryptString).mockImplementation((buffer: Buffer) =>
        buffer.toString(),
      );

      mockStoreManager.get.mockImplementation((key) => {
        if (key === 'dataSyncConfig') {
          return {
            active: true,
            remoteServerUrl: 'https://server.com',
            storageMode: 'selfHost',
          };
        }
        return null;
      });

      await controller.saveTokens('old-access', 'old-refresh');

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await controller.refreshAccessToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it.each(['fetch', 'success body', 'error body'])(
      'should time out a stalled refresh %s and allow a later retry',
      async (stalledPhase) => {
        vi.useFakeTimers();
        try {
          mockStoreManager.get.mockImplementation((key) => {
            if (key === 'dataSyncConfig') {
              return {
                active: true,
                remoteServerUrl: 'https://server.com',
                storageMode: 'selfHost',
              };
            }
            return null;
          });
          await controller.saveTokens('old-access', 'old-refresh');

          let requestSignal: AbortSignal | undefined;
          mockFetch.mockImplementation((_url, init) => {
            requestSignal = init?.signal as AbortSignal | undefined;
            if (stalledPhase === 'fetch') return new Promise(() => {});

            return Promise.resolve({
              json: () => new Promise(() => {}),
              ok: stalledPhase !== 'error body',
              status: stalledPhase === 'error body' ? 503 : 200,
              statusText: stalledPhase === 'error body' ? 'Service Unavailable' : 'OK',
            });
          });

          const stalledRefresh = controller.refreshAccessToken();
          await vi.advanceTimersByTimeAsync(30_000);

          await expect(stalledRefresh).resolves.toEqual({
            error:
              'Exception occurred during token refresh: Token refresh timed out after 30 seconds',
            success: false,
          });
          expect(requestSignal?.aborted).toBe(true);

          mockFetch.mockResolvedValue({
            json: () =>
              Promise.resolve({
                access_token: 'retry-access',
                expires_in: 3600,
                refresh_token: 'retry-refresh',
              }),
            ok: true,
          });

          await expect(controller.refreshAccessToken()).resolves.toEqual({ success: true });
          expect(mockFetch).toHaveBeenCalledTimes(2);
        } finally {
          vi.useRealTimers();
        }
      },
    );
  });

  describe('afterAppReady', () => {
    it('restores auth.json when its issuer matches', async () => {
      auth.record = {
        accessToken: 'stored',
        refreshToken: 'refresh',
        issuerOrigin: 'https://masterino.bielcrystal.com',
        lastRefreshAt: 42,
      };
      controller.afterAppReady();
      await expect(controller.getAccessToken()).resolves.toBe('stored');
      expect(controller.getLastTokenRefreshAt()).toBe(42);
    });
    it('does not expose credentials to a different server', async () => {
      auth.record = {
        accessToken: 'other-server',
        refreshToken: 'refresh',
        issuerOrigin: 'https://other.example',
      };
      controller.afterAppReady();
      await expect(controller.getAccessToken()).resolves.toBeNull();
      expect(auth.clear).not.toHaveBeenCalled();
    });
  });

  describe('getLastTokenRefreshAt', () => {
    it('should return undefined when no tokens have been saved', () => {
      expect(controller.getLastTokenRefreshAt()).toBeUndefined();
    });

    it('should return the last refresh time after saving tokens', async () => {
      const beforeSave = Date.now();
      await controller.saveTokens('access', 'refresh', 3600);
      const afterSave = Date.now();

      const lastRefreshAt = controller.getLastTokenRefreshAt();

      expect(lastRefreshAt).toBeDefined();
      expect(lastRefreshAt).toBeGreaterThanOrEqual(beforeSave);
      expect(lastRefreshAt).toBeLessThanOrEqual(afterSave);
    });

    it('should persist lastRefreshAt to store when saving tokens', async () => {
      await controller.saveTokens('access', 'refresh', 3600);

      expect(auth.write).toHaveBeenCalledWith(
        expect.objectContaining({ lastRefreshAt: expect.any(Number) }),
      );
    });
  });

  describe('getRemoteServerUrl', () => {
    it('should return official cloud server for cloud mode', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        storageMode: 'cloud',
      });

      const result = await controller.getRemoteServerUrl();

      expect(result).toBe('https://masterino.bielcrystal.com');
    });

    it('should return custom URL for selfHost mode', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        remoteServerUrl: 'https://my-server.com',
        storageMode: 'selfHost',
      });

      const result = await controller.getRemoteServerUrl();

      expect(result).toBe('https://my-server.com');
    });

    it('should use provided config instead of stored config', async () => {
      const customConfig: DataSyncConfig = {
        active: true,
        remoteServerUrl: 'https://custom-server.com',
        storageMode: 'selfHost',
      };

      const result = await controller.getRemoteServerUrl(customConfig);

      expect(result).toBe('https://custom-server.com');
    });
  });

  describe('isRemoteServerConfigured', () => {
    it('should return false when active is undefined', async () => {
      mockStoreManager.get.mockReturnValue({
        storageMode: 'cloud',
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(false);
    });

    it('should return true for active cloud mode (no remoteServerUrl needed)', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        storageMode: 'cloud',
        // remoteServerUrl is undefined for cloud mode
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(true);
    });

    it('should return true for active selfHost mode with remoteServerUrl', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        remoteServerUrl: 'https://my-server.com',
        storageMode: 'selfHost',
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(true);
    });

    it('should return false for inactive config', async () => {
      mockStoreManager.get.mockReturnValue({
        active: false,
        storageMode: 'cloud',
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(false);
    });

    it('should return false for selfHost mode without remoteServerUrl', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        storageMode: 'selfHost',
        // remoteServerUrl is undefined
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(false);
    });

    it('should return false for selfHost mode with blank remoteServerUrl', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        remoteServerUrl: '   ',
        storageMode: 'selfHost',
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(false);
    });

    it('should return false for selfHost mode with invalid remoteServerUrl', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        remoteServerUrl: 'foo',
        storageMode: 'selfHost',
      });

      const result = await controller.isRemoteServerConfigured();

      expect(result).toBe(false);
    });

    it('should use provided config instead of fetching', async () => {
      // Store has inactive config
      mockStoreManager.get.mockReturnValue({
        active: false,
        storageMode: 'cloud',
      });

      // But we provide an active config
      const result = await controller.isRemoteServerConfigured({
        active: true,
        storageMode: 'cloud',
      });

      expect(result).toBe(true);
    });
  });

  describe('setupSubscriptionWebviewSession', () => {
    const setupRequestHandler = async () => {
      await controller.setupSubscriptionWebviewSession({ partition: 'persist:subscription' });

      expect(mockFromPartition).toHaveBeenCalledWith('persist:subscription');
      expect(mockOnBeforeSendHeaders).toHaveBeenCalledWith(
        { urls: ['http://*/*', 'https://*/*'] },
        expect.any(Function),
      );

      return mockOnBeforeSendHeaders.mock.calls[0]![1];
    };

    it('should remove existing auth headers and fail closed while the config is inactive', async () => {
      mockStoreManager.get.mockReturnValue({ active: false, storageMode: 'cloud' });
      const getAccessToken = vi.spyOn(controller, 'getAccessToken');
      const handler = await setupRequestHandler();
      const callback = vi.fn();

      await handler(
        {
          requestHeaders: { 'oIdC-AuTh': 'renderer-supplied-token', 'X-Test': '1' },
          url: 'https://masterino.bielcrystal.com/subscription',
        },
        callback,
      );

      expect(getAccessToken).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith({ requestHeaders: { 'X-Test': '1' } });
    });

    it.each([
      'https://aihub.bielcrystal.com/subscription',
      'https://sibling.bielcrystal.com/subscription',
      'https://unrelated.example.com/subscription',
    ])('should not inject the current token into a different origin: %s', async (url) => {
      mockStoreManager.get.mockReturnValue({ active: true, storageMode: 'cloud' });
      const getAccessToken = vi
        .spyOn(controller, 'getAccessToken')
        .mockResolvedValue('masterlion-token');
      const handler = await setupRequestHandler();
      const callback = vi.fn();

      await handler({ requestHeaders: { 'OIDC-AUTH': 'renderer-supplied-token' }, url }, callback);

      expect(getAccessToken).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith({ requestHeaders: {} });
    });

    it('should replace existing auth headers only for the active matching self-hosted origin', async () => {
      mockStoreManager.get.mockReturnValue({
        active: true,
        remoteServerUrl: 'https://self-hosted.example.com/base',
        storageMode: 'selfHost',
      });
      vi.spyOn(controller, 'getAccessToken').mockResolvedValue('self-hosted-token');
      const handler = await setupRequestHandler();
      const callback = vi.fn();

      await handler(
        {
          requestHeaders: {
            'oidc-auth': 'stale-lowercase-token',
            'OIDC-AUTH': 'stale-uppercase-token',
            'X-Test': '1',
          },
          url: 'https://self-hosted.example.com/subscription?plan=team',
        },
        callback,
      );

      expect(callback).toHaveBeenCalledWith({
        requestHeaders: { 'Oidc-Auth': 'self-hosted-token', 'X-Test': '1' },
      });
    });
  });
});
