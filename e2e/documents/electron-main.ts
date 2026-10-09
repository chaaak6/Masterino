import { app } from 'electron';
import { DocumentJobs } from '../../apps/desktop/src/main/modules/documentJobs';
if (process.env.APP_URL !== 'https://mlai-test.bielcrystal.com')
  throw new Error('Test APP_URL required');
app.setPath('userData', process.env.MASTERINO_DOCUMENT_PROFILE!);
app.on('window-all-closed', () => {
  /* Test shell has no user window. */
});
app.whenReady().then(() => {
  (globalThis as any).documents = new DocumentJobs(
    process.env.MASTERINO_DOCUMENT_CACHE!,
    process.env.MASTERINO_DOCUMENT_WORKER!,
  );
  (globalThis as any).documentsReady = true;
});
