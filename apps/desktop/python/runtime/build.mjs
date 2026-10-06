import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sources = {
  'darwin-arm64': [
    'aarch64-apple-darwin',
    'c2edb321cd32ec2b170df208db0446dccc4398db602ca27cf2079098fb1f7d9d',
  ],
  'darwin-x64': [
    'x86_64-apple-darwin',
    '7ea9761b9069c10b9a20531d568645849d604c59e9c7f11f6659f1e1790c968e',
  ],
  'win32-x64': [
    'x86_64-pc-windows-msvc',
    'c5bf8edfe858c1df9891be498b5bbc8761d383df5b9790658b088fea4870433a',
  ],
};
const target = `${process.platform}-${process.arch}`;
const source = sources[target];
if (!source) throw new Error(`Unsupported bundled Python target: ${target}`);
const here = path.dirname(fileURLToPath(import.meta.url));
const destination = path.resolve(here, '../../resources/python-runtime');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'masterino-python-'));
try {
  const archive = path.join(temporary, 'python.tar.gz');
  const name = `cpython-3.12.14%2B20260924-${source[0]}-install_only_stripped.tar.gz`;
  const response = await fetch(
    `https://github.com/astral-sh/python-build-standalone/releases/download/20260924/${name}`,
  );
  if (!response.ok) throw new Error(`Python download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== source[1])
    throw new Error('Python archive checksum mismatch');
  await writeFile(archive, bytes);
  execFileSync('tar', ['-xzf', archive, '-C', temporary], { stdio: 'inherit' });
  const runtime = path.join(temporary, 'python');
  const executable = process.platform === 'win32' ? 'python.exe' : 'bin/python3';
  const python = path.join(runtime, executable);
  execFileSync(
    python,
    [
      '-I',
      '-B',
      '-m',
      'pip',
      'install',
      '--no-cache-dir',
      '-r',
      path.join(here, 'requirements.txt'),
    ],
    { stdio: 'inherit' },
  );
  const packages = ['python-pptx', 'Pillow', 'lxml', 'XlsxWriter', 'typing-extensions'];
  const probe = `import json, platform, importlib.metadata as m; import pptx, PIL, lxml.etree, xlsxwriter; print(json.dumps({'version': platform.python_version(), 'packages': {n: m.version(n) for n in ${JSON.stringify(packages)}}}))`;
  const info = JSON.parse(execFileSync(python, ['-I', '-B', '-c', probe], { encoding: 'utf8' }));
  await writeFile(
    path.join(runtime, 'manifest.json'),
    JSON.stringify({ ...info, executable, target }, null, 2) + '\n',
  );
  execFileSync(python, ['-I', '-B', path.join(here, 'test_runtime.py')], { stdio: 'inherit' });
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(runtime, destination, { recursive: true, verbatimSymlinks: true });
  console.log(`Bundled Python ${info.version}: ${destination}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

// Check only after the temporary download/extraction tree has been removed.
execFileSync(
  path.join(destination, process.platform === 'win32' ? 'python.exe' : 'bin/python3'),
  ['-I', '-B', path.join(here, 'test_runtime.py')],
  { stdio: 'inherit' },
);
