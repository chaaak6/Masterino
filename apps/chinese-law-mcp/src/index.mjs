import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const snapshot = JSON.parse(
  await readFile(new URL('../data/snapshot.json', import.meta.url), 'utf8'),
);
const service = await startServer({
  dataDirectory,
  dataVersion: snapshot.commit,
  port: Number(process.env.PORT || 3230),
});
console.info(
  JSON.stringify({ event: 'ready', port: service.address().port, dataVersion: snapshot.commit }),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, async () => {
    await service.close();
    process.exit(0);
  });
