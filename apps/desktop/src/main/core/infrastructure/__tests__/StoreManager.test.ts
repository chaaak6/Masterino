import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App as AppCore } from '../../App';
import { APPLIED_STORE_MIGRATIONS_KEY, getStoreMigrations, runStoreMigrations } from '../migration';
import { StoreManager } from '../StoreManager';

// Use vi.hoisted to define mocks before hoisting
const { mockStoreInstance, mockMakeSureDirExist, MockStore } = vi.hoisted(() => {
  const mockStoreInstance = {
    clear: vi.fn(),
    delete: vi.fn(),
    get: vi.fn().mockImplementation((key: string, defaultValue?: any) => {
      if (key === 'storagePath') return '/mock/storage/path';
      return defaultValue;
    }),
    has: vi.fn().mockReturnValue(false),
    openInEditor: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(),
  };

  const MockStore = vi.fn().mockImplementation(() => mockStoreInstance);

  return {
    MockStore,
    mockMakeSureDirExist: vi.fn(),
    mockStoreInstance,
  };
});

// Mock electron-store
vi.mock('electron-store', () => ({
  default: MockStore,
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock file-system utils
vi.mock('@/utils/file-system', () => ({
  makeSureDirExist: mockMakeSureDirExist,
}));

vi.mock('@/modules/updater/configs', () => ({
  coerceStoredUpdateChannel: (channel?: string | null) =>
    channel === 'canary' ? 'canary' : 'stable',
}));

// Mock store constants
vi.mock('@/const/store', () => ({
  STORE_DEFAULTS: {
    locale: 'auto',
    storagePath: '/default/storage/path',
  },
  STORE_NAME: 'test-config',
}));

describe('StoreManager', () => {
  let manager: StoreManager;
  let mockAppCore: AppCore;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store mock behaviors
    mockStoreInstance.get.mockImplementation((key: string, defaultValue?: any) => {
      if (key === 'storagePath') return '/mock/storage/path';
      return defaultValue;
    });
    mockStoreInstance.has.mockReturnValue(false);

    // Create mock App core
    mockAppCore = {} as unknown as AppCore;

    manager = new StoreManager(mockAppCore);
  });

  describe('constructor', () => {
    it('should create electron-store with correct options', () => {
      expect(MockStore).toHaveBeenCalledWith(
        expect.objectContaining({
          defaults: {
            locale: 'auto',
            storagePath: '/default/storage/path',
          },
          name: 'test-config',
        }),
      );
    });

    it('should ensure storage directory exists', () => {
      expect(mockMakeSureDirExist).toHaveBeenCalledWith('/mock/storage/path');
    });

    it('should migrate legacy nightly channel and record applied migration ids', () => {
      const store = {
        get: vi.fn((key: string) => {
          if (key === APPLIED_STORE_MIGRATIONS_KEY) return undefined;
          if (key === 'updateChannel') return 'nightly';
        }),
        set: vi.fn(),
      } as any;

      runStoreMigrations(store);

      expect(store.set).toHaveBeenCalledWith('updateChannel', 'stable');
      expect(store.set).toHaveBeenCalledWith(
        APPLIED_STORE_MIGRATIONS_KEY,
        getStoreMigrations().map(({ id }) => id),
      );
    });

    it.each([
      ['https://aihub.bielcrystal.com', 'https://masterino.bielcrystal.com'],
      [' https://aihub.bielcrystal.com/ ', 'https://masterino.bielcrystal.com'],
    ])(
      'upgrades saved cloud server %s before configuration is read',
      (remoteServerUrl, expected) => {
        const saved = new Map<string, unknown>([
          [APPLIED_STORE_MIGRATIONS_KEY, ['001-normalize-update-channel']],
          ['dataSyncConfig', { active: true, remoteServerUrl, storageMode: 'cloud' }],
        ]);
        mockStoreInstance.get.mockImplementation((key) => saved.get(key));
        mockStoreInstance.set.mockImplementation((key, value) => saved.set(key, value));

        const upgraded = new StoreManager(mockAppCore);
        expect(upgraded.get('dataSyncConfig')).toEqual({
          active: false,
          remoteServerUrl: expected,
          storageMode: 'cloud',
        });
        mockStoreInstance.set.mockClear();
        new StoreManager(mockAppCore);
        expect(mockStoreInstance.set).not.toHaveBeenCalled();
      },
    );

    it.each([
      { storageMode: 'selfHost', remoteServerUrl: 'https://aihub.bielcrystal.com' },
      { storageMode: 'cloud', remoteServerUrl: 'https://mlai-test.bielcrystal.com' },
      { storageMode: 'cloud', remoteServerUrl: 'https://masterino.bielcrystal.com' },
      { storageMode: 'cloud', remoteServerUrl: 'https://aihub.bielcrystal.com/custom' },
      { storageMode: 'cloud' },
    ])('preserves unrelated server configuration %j', (config) => {
      mockStoreInstance.get.mockImplementation((key) =>
        key === 'dataSyncConfig' ? config : undefined,
      );
      new StoreManager(mockAppCore);
      expect(mockStoreInstance.set).not.toHaveBeenCalledWith('dataSyncConfig', expect.anything());
    });

    it('should skip already applied migrations', () => {
      const appliedMigrationIds = getStoreMigrations().map(({ id }) => id);
      const store = {
        get: vi.fn((key: string) => {
          if (key === APPLIED_STORE_MIGRATIONS_KEY) return appliedMigrationIds;
          if (key === 'updateChannel') return 'nightly';
        }),
        set: vi.fn(),
      } as any;

      runStoreMigrations(store);

      expect(store.set).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should call store.get with key', () => {
      mockStoreInstance.get.mockReturnValue('test-value');

      const result = manager.get('locale' as any);

      expect(mockStoreInstance.get).toHaveBeenCalledWith('locale', undefined);
      expect(result).toBe('test-value');
    });

    it('should call store.get with key and default value', () => {
      mockStoreInstance.get.mockImplementation((_key: string, defaultValue?: any) => defaultValue);

      const result = manager.get('locale' as any, 'en-US' as any);

      expect(mockStoreInstance.get).toHaveBeenCalledWith('locale', 'en-US');
      expect(result).toBe('en-US');
    });
  });

  describe('set', () => {
    it('should call store.set with key and value', () => {
      manager.set('locale' as any, 'zh-CN' as any);

      expect(mockStoreInstance.set).toHaveBeenCalledWith('locale', 'zh-CN');
    });
  });

  describe('delete', () => {
    it('should call store.delete with key', () => {
      manager.delete('locale' as any);

      expect(mockStoreInstance.delete).toHaveBeenCalledWith('locale');
    });
  });

  describe('clear', () => {
    it('should call store.clear', () => {
      manager.clear();

      expect(mockStoreInstance.clear).toHaveBeenCalled();
    });
  });

  describe('has', () => {
    it('should return true when key exists', () => {
      mockStoreInstance.has.mockReturnValue(true);

      const result = manager.has('locale' as any);

      expect(mockStoreInstance.has).toHaveBeenCalledWith('locale');
      expect(result).toBe(true);
    });

    it('should return false when key does not exist', () => {
      mockStoreInstance.has.mockReturnValue(false);

      const result = manager.has('nonExistent' as any);

      expect(result).toBe(false);
    });
  });

  describe('openInEditor', () => {
    it('should call store.openInEditor', async () => {
      await manager.openInEditor();

      expect(mockStoreInstance.openInEditor).toHaveBeenCalled();
    });
  });
});
