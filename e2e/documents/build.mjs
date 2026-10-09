import { build } from 'vite';
import path from 'node:path';
const root = process.cwd();
for (const [name, entry] of [
  ['device-attachments', 'e2e/documents/attachments-entry.ts'],
  ['electron-main', 'e2e/documents/electron-main.ts'],
  ['document-worker', 'packages/file-loaders/src/documents/worker.ts'],
]) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    ssr: { noExternal: true },
    logLevel: 'warn',
    build: {
      ssr: true,
      outDir: 'e2e/documents/.artifacts',
      emptyOutDir: false,
      rolldownOptions: {
        input: path.resolve(entry),
        external: ['electron', '@napi-rs/canvas'],
        output: { format: 'cjs', entryFileNames: name + '.js' },
      },
    },
  });
}
