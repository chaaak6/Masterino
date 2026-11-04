import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveMasterinoHomePaths } from './masterinoHome';

describe('resolveMasterinoHomePaths', () => {
  it('places managed data under ~/.masterino by default', () => {
    const homeDirectory = path.resolve('/users/tester');

    expect(resolveMasterinoHomePaths({ env: {}, homeDirectory })).toEqual({
      cacheRoot: path.join(homeDirectory, '.masterino', 'cache'),
      home: path.join(homeDirectory, '.masterino'),
      scratchRoot: path.join(homeDirectory, '.masterino', 'workspaces', 'scratch'),
      skillsRoot: path.join(homeDirectory, '.masterino', 'skills'),
      stateRoot: path.join(homeDirectory, '.masterino', 'state'),
    });
  });

  it('uses an absolute MASTERINO_HOME without changing its layout', () => {
    const configuredHome = path.resolve('/var/tmp/masterino-test');

    expect(
      resolveMasterinoHomePaths({
        env: { MASTERINO_HOME: configuredHome },
        homeDirectory: path.resolve('/users/tester'),
      }),
    ).toMatchObject({
      cacheRoot: path.join(configuredHome, 'cache'),
      home: configuredHome,
      scratchRoot: path.join(configuredHome, 'workspaces', 'scratch'),
      skillsRoot: path.join(configuredHome, 'skills'),
      stateRoot: path.join(configuredHome, 'state'),
    });
  });

  it('rejects a relative MASTERINO_HOME so managed data cannot depend on cwd', () => {
    expect(() =>
      resolveMasterinoHomePaths({
        env: { MASTERINO_HOME: '.masterino-test' },
        homeDirectory: path.resolve('/users/tester'),
      }),
    ).toThrow('MASTERINO_HOME must be an absolute path');
  });

  it('does not let the legacy CLI-only override change the shared home', () => {
    const homeDirectory = path.resolve('/users/tester');

    expect(
      resolveMasterinoHomePaths({
        env: { LOBEHUB_CLI_HOME: '.lobehub-development' },
        homeDirectory,
      }).home,
    ).toBe(path.join(homeDirectory, '.masterino'));
  });
});
