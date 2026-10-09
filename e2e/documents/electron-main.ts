import { app } from 'electron';
import { DocumentJobs } from '../../apps/desktop/src/main/modules/documentJobs';
import { getBundledPythonInfo } from '../../apps/desktop/src/main/modules/pythonRuntime';
if (process.env.APP_URL !== 'https://mlai-test.bielcrystal.com')
  throw new Error('Test APP_URL required');
app.setPath('userData', process.env.MASTERINO_DOCUMENT_PROFILE!);
app.on('window-all-closed', () => {
  /* Test shell has no user window. */
});
let cleanupComplete = false;
let cleanupStarted = false;
app.on('before-quit', (event) => {
  if (cleanupComplete) return;
  event.preventDefault();
  if (cleanupStarted) return;
  cleanupStarted = true;
  void ((globalThis as any).documents?.cleanup?.() ?? Promise.resolve()).finally(() => {
    cleanupComplete = true;
    app.quit();
  });
});
app.whenReady().then(() => {
  (globalThis as any).getBundledPythonInfo = getBundledPythonInfo;
  (globalThis as any).documents = new DocumentJobs(
    process.env.MASTERINO_DOCUMENT_CACHE!,
    process.env.MASTERINO_DOCUMENT_WORKER!,
  );
  (globalThis as any).documentsReady = true;
});
