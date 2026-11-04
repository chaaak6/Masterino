import os from 'node:os';
import path from 'node:path';

import { resolveMasterinoHomePaths } from '@lobechat/device-control/masterinoHome';

export const resolveCliManagedPaths = () => {
  const homeDirectory = os.homedir();
  const configuredLegacyHome = process.env.LOBEHUB_CLI_HOME?.trim();
  const legacyHome = configuredLegacyHome
    ? path.resolve(homeDirectory, configuredLegacyHome)
    : path.join(homeDirectory, '.lobehub');
  const paths = resolveMasterinoHomePaths({
    env:
      !process.env.MASTERINO_HOME && configuredLegacyHome
        ? { ...process.env, MASTERINO_HOME: legacyHome }
        : process.env,
    homeDirectory,
  });

  return { ...paths, legacyStateRoot: legacyHome };
};
