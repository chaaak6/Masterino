import path from 'node:path';

import { resolveMasterinoHomePaths } from '@lobechat/device-control/masterinoHome';

export const resolveDesktopManagedPaths = (appStoragePath: string) => {
  const paths = resolveMasterinoHomePaths();
  const legacyScratchRoot = path.join(appStoragePath, 'scratch-workspaces');

  return {
    ...paths,
    legacyScratchRoots:
      path.resolve(legacyScratchRoot) === path.resolve(paths.scratchRoot)
        ? []
        : [legacyScratchRoot],
  };
};
