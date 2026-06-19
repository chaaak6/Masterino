export const isPlatformAdminRole = (role?: null | string): boolean =>
  role === 'platform_admin' || role === 'super_admin';

export const hasRequiredPermission = (grants: string[], required: string): boolean => {
  if (grants.includes(required) || grants.includes('*')) return true;

  const [namespace] = required.split(':');
  return Boolean(namespace && grants.includes(`${namespace}:*`));
};

export const assertPermission = (grants: string[], required: string) => {
  if (!hasRequiredPermission(grants, required)) {
    throw new Error(`Missing permission: ${required}`);
  }
};
