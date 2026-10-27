import path from 'node:path';

import { app } from 'electron';
import * as electronIs from 'electron-is';

// Keep the runtime application name aligned with the packaged product name.
// Electron otherwise falls back to package.json's internal package name in
// development and in a few Windows shell surfaces.
app.setName('Masterino');

// Must run BEFORE any module captures `app.getPath('userData')` (e.g. `@/const/dir`
// reads it at top level). Once a path is read, `setName` / `setPath` no-op for it.
//
// Dev and packaged test builds use the same `app://renderer/` origin as prod, so
// localStorage / cookies / IndexedDB and the single-instance lock would collide if
// they shared the packaged app's userData dir. Pin each flavor to a sibling
// directory so a test executable cannot take over launches of the installed app.
const testBuild = process.env.DESKTOP_BUILD_FLAVOR === 'test';
if (electronIs.dev() || testBuild) {
  const profile = testBuild
    ? process.env.DESKTOP_TEST_PROFILE
    : !app.isPackaged && process.env.MASTERINO_DESKTOP_PROFILE;
  if (profile && !/^(?:local-[a-f0-9]{12}|test-server)$/.test(profile)) {
    throw new Error('Invalid isolated development desktop profile');
  }
  const directoryName = profile
    ? `masterino-desktop-${profile}`
    : testBuild
      ? 'masterino-desktop-test'
      : 'masterino-desktop-dev';
  app.setPath('userData', path.join(app.getPath('appData'), directoryName));
  if (testBuild && profile) app.setAppLogsPath(path.join(app.getPath('userData'), 'logs'));
}
