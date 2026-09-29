import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = path.dirname(fileURLToPath(import.meta.url));
const python =
  process.env.PPT_WORKER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3.12');
const result = spawnSync(python, [path.join(folder, 'build.py')], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
