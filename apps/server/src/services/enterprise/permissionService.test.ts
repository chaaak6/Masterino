// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { assertPermission, hasRequiredPermission, isPlatformAdminRole } from './permissionService';

describe('permissionService', () => {
  describe('isPlatformAdminRole', () => {
    it('returns true for platform_admin', () => {
      expect(isPlatformAdminRole('platform_admin')).toBe(true);
    });

    it('returns true for super_admin', () => {
      expect(isPlatformAdminRole('super_admin')).toBe(true);
    });

    it('returns false for admin', () => {
      expect(isPlatformAdminRole('admin')).toBe(false);
    });

    it('returns false for null or undefined roles', () => {
      expect(isPlatformAdminRole(null)).toBe(false);
      expect(isPlatformAdminRole(undefined)).toBe(false);
    });
  });

  describe('hasRequiredPermission', () => {
    it('returns true for an exact grant match', () => {
      expect(hasRequiredPermission(['admin:user:read'], 'admin:user:read')).toBe(true);
    });

    it('returns true for a namespace wildcard grant', () => {
      expect(hasRequiredPermission(['admin:*'], 'admin:user:read')).toBe(true);
    });

    it('returns true for a global wildcard grant', () => {
      expect(hasRequiredPermission(['*'], 'admin:user:read')).toBe(true);
    });

    it('returns false when no grant matches the required permission', () => {
      expect(hasRequiredPermission(['knowledge_base:read'], 'admin:user:read')).toBe(false);
    });
  });

  describe('assertPermission', () => {
    it('does not throw for an exact grant match', () => {
      expect(() => assertPermission(['admin:user:read'], 'admin:user:read')).not.toThrow();
    });

    it('throws a missing permission error when no grant matches', () => {
      expect(() => assertPermission(['knowledge_base:read'], 'admin:user:read')).toThrow(
        'Missing permission: admin:user:read',
      );
    });
  });
});
