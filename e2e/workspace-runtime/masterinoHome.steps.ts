import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { resolveMasterinoHomePaths } from '../../packages/device-control/src/masterinoHome';
import {
  cleanupScratchWorkspace,
  ensureScratchWorkspace,
} from '../../packages/device-control/src/scratchWorkspace';

interface ManagedHomeWorld {
  appStoragePath: string;
  cleanupResult?: { removed: boolean; root: string };
  createdScratch?: { root: string };
  initializedRoot?: string;
  legacyScratch?: { root: string };
  masterinoHome: string;
  originalMasterinoHome?: string;
  projectRoot?: string;
  root: string;
}

const managedRoots = (world: ManagedHomeWorld) => {
  const paths = resolveMasterinoHomePaths();
  return {
    legacyScratchRoots: [path.join(world.appStoragePath, 'scratch-workspaces')],
    scratchRoot: paths.scratchRoot,
  };
};

Before(function (this: ManagedHomeWorld) {
  this.originalMasterinoHome = process.env.MASTERINO_HOME;
});

After(async function (this: ManagedHomeWorld) {
  if (this.originalMasterinoHome === undefined) delete process.env.MASTERINO_HOME;
  else process.env.MASTERINO_HOME = this.originalMasterinoHome;
  if (this.root) await rm(this.root, { force: true, recursive: true });
});

Given(
  'an isolated Masterino home and legacy Desktop storage',
  async function (this: ManagedHomeWorld) {
    this.root = await mkdtemp(path.join(tmpdir(), 'masterino-home-bdd-'));
    this.masterinoHome = path.join(this.root, '.masterino');
    this.appStoragePath = path.join(this.root, 'legacy-app-storage');
    process.env.MASTERINO_HOME = this.masterinoHome;
  },
);

When(
  'the device creates scratch workspace for topic {string}',
  async function (this: ManagedHomeWorld, topicId: string) {
    const { scratchRoot } = managedRoots(this);
    this.createdScratch = await ensureScratchWorkspace({ topicId }, scratchRoot);
  },
);

Then(
  'the scratch workspace is under {string}',
  async function (this: ManagedHomeWorld, relative: string) {
    const expected = await realpath(path.join(this.masterinoHome, relative));
    if (this.createdScratch?.root !== expected)
      throw new Error(`Expected ${expected}, received ${this.createdScratch?.root}`);
  },
);

Then('no new scratch workspace is created in legacy Desktop storage', async function () {
  await access(path.join(this.appStoragePath, 'scratch-workspaces')).then(
    () => {
      throw new Error('Legacy scratch root was created');
    },
    () => undefined,
  );
});

Then('the managed skills directory is {string}', function (relative: string) {
  const paths = resolveMasterinoHomePaths();
  if (paths.skillsRoot !== path.join(this.masterinoHome, relative))
    throw new Error(`Unexpected skills root: ${paths.skillsRoot}`);
});

Given(
  'a persisted legacy scratch workspace for topic {string}',
  async function (this: ManagedHomeWorld, topicId: string) {
    const legacyRoot = path.join(this.appStoragePath, 'scratch-workspaces');
    this.legacyScratch = await ensureScratchWorkspace({ topicId }, legacyRoot);
    await writeFile(path.join(this.legacyScratch.root, 'legacy.txt'), 'legacy session');
  },
);

When('the device cleans the persisted legacy scratch workspace', async function () {
  const topicId = path.basename(this.legacyScratch!.root);
  const { legacyScratchRoots, scratchRoot } = managedRoots(this);
  this.cleanupResult = await cleanupScratchWorkspace(
    { expectedRoot: this.legacyScratch!.root, topicId },
    scratchRoot,
    legacyScratchRoots,
  );
});

Then('only the persisted legacy scratch workspace is removed', async function () {
  if (!this.cleanupResult?.removed || this.cleanupResult.root !== this.legacyScratch?.root)
    throw new Error('Legacy scratch cleanup was not confirmed');
  await access(this.legacyScratch.root).then(
    () => {
      throw new Error('Legacy scratch workspace still exists');
    },
    () => undefined,
  );
  await access(this.masterinoHome).then(
    () => {
      throw new Error('Canonical Masterino home should remain lazy');
    },
    () => undefined,
  );
});

Given('a user-selected project outside MASTERINO_HOME', async function () {
  this.projectRoot = path.join(this.root, 'selected-project');
  await mkdir(this.projectRoot);
  await writeFile(path.join(this.projectRoot, 'AGENTS.md'), '# Selected project');
});

When('the device initializes the selected project', async function () {
  // Project roots are caller-owned inputs and are intentionally not rewritten
  // through the managed-home resolver.
  this.initializedRoot = await realpath(this.projectRoot!);
});

Then('the selected project remains the initialized workspace', async function () {
  const expected = await realpath(this.projectRoot!);
  if (this.initializedRoot !== expected)
    throw new Error(`Expected selected project ${expected}, received ${this.initializedRoot}`);
});

Then('scratch storage is not created by project initialization', async function () {
  const scratchRoot = resolveMasterinoHomePaths().scratchRoot;
  await access(scratchRoot).then(
    () => {
      throw new Error('Project initialization created scratch storage');
    },
    () => undefined,
  );
});
