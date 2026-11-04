import os from 'node:os';
import path from 'node:path';

export interface MasterinoHomePaths {
  cacheRoot: string;
  home: string;
  scratchRoot: string;
  skillsRoot: string;
  stateRoot: string;
}

export interface ResolveMasterinoHomeOptions {
  env?: Record<string, string | undefined>;
  homeDirectory?: string;
}

const resolveConfiguredHome = (
  env: Record<string, string | undefined>,
  homeDirectory: string,
): string => {
  const configuredHome = env.MASTERINO_HOME?.trim();
  if (configuredHome) {
    if (!path.isAbsolute(configuredHome)) {
      throw new Error('MASTERINO_HOME must be an absolute path');
    }

    return path.resolve(configuredHome);
  }

  return path.join(homeDirectory, '.masterino');
};

export const resolveMasterinoHomePaths = (
  options: ResolveMasterinoHomeOptions = {},
): MasterinoHomePaths => {
  const env = options.env ?? process.env;
  const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
  const home = resolveConfiguredHome(env, homeDirectory);

  return {
    cacheRoot: path.join(home, 'cache'),
    home,
    scratchRoot: path.join(home, 'workspaces', 'scratch'),
    skillsRoot: path.join(home, 'skills'),
    stateRoot: path.join(home, 'state'),
  };
};
