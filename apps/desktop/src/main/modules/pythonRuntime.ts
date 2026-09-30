import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { app } from 'electron';

export interface BundledPythonInfo {
  executable: string;
  packages: Record<string, string>;
  sitePackages: string;
  venvRoot: string;
  version: string;
}

const imports: Record<string, string> = {
  'Pillow': 'PIL',
  'python-pptx': 'pptx',
  'XlsxWriter': 'xlsxwriter',
};

export function formatPythonEnvironment(info?: BundledPythonInfo): string {
  if (!info)
    return 'Bundled Python is unavailable on this device. Check available runtimes before using Python.';
  const packages = Object.entries(info.packages)
    .map(
      ([name, version]) =>
        `${name}==${version} (import ${imports[name] ?? name.replaceAll('-', '_')})`,
    )
    .join(', ');
  const venv = path.join(info.venvRoot, 'project-env');
  const venvPython = path.join(
    venv,
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  return `Python ${info.version}
Executable: "${info.executable}"
Package directory: "${info.sitePackages}"
Preinstalled packages: ${packages}
Use "${info.executable}" -I -B -X utf8 <script.py>. These packages are already importable; no host Python or PATH changes are needed. Treat the application runtime as read-only: never install or upgrade packages in it, and never use its -m pip to manage dependencies.
For additional packages, create a project-specific virtual environment under "${info.venvRoot}". Example:
"${info.executable}" -I -B -X utf8 -m venv --without-pip --system-site-packages "${venv}"
Then install only with "${venvPython}" -I -B -X utf8 -m pip install <additional-package>, and run project scripts with that virtual environment's Python and the same flags. The virtual environment inherits the preinstalled packages. Use a distinct environment per project; do not use --user or alter host Python.`;
}

let infoPromise: Promise<BundledPythonInfo | undefined> | undefined;

export function getBundledPythonInfo(): Promise<BundledPythonInfo | undefined> {
  infoPromise ??= (async () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return undefined;
    const resources = app.isPackaged
      ? process.resourcesPath
      : path.join(app.getAppPath(), 'resources');
    const executable = path.join(
      resources,
      'python-runtime',
      process.platform === 'win32' ? 'python.exe' : 'bin/python3',
    );
    try {
      const { stdout } = await promisify(execFile)(
        executable,
        [
          '-I',
          '-B',
          '-X',
          'utf8',
          '-c',
          'import json, platform, pathlib, importlib.metadata as m; import pptx, PIL, lxml.etree, xlsxwriter; print(json.dumps({"version": platform.python_version(), "sitePackages": str(pathlib.Path(pptx.__file__).parent.parent), "packages": {n: m.version(n) for n in ["python-pptx", "Pillow", "lxml", "XlsxWriter", "typing-extensions"]}}))',
        ],
        { timeout: 10_000, windowsHide: true },
      );
      return {
        ...JSON.parse(stdout),
        executable,
        venvRoot: path.join(app.getPath('userData'), 'python-environments'),
      } as BundledPythonInfo;
    } catch {
      return undefined;
    }
  })();
  return infoPromise;
}

export async function getPythonEnvironment(): Promise<string> {
  return formatPythonEnvironment(await getBundledPythonInfo());
}
