import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { app } from 'electron';

export interface BundledPythonInfo {
  executable: string;
  packages: Record<string, string>;
  sitePackages: string;
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
  return `Python ${info.version}\nExecutable: "${info.executable}"\nPackage directory: "${info.sitePackages}"\nPreinstalled packages: ${packages}\nThese packages are importable with this interpreter without configuring sys.path. Local runCommand prioritizes this interpreter directory on PATH. Use this absolute path with -X utf8 for scripts and -m pip for package management; no host Python installation is needed.`;
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
          '-c',
          'import json, platform, pathlib, importlib.metadata as m; import pptx, PIL, lxml.etree, xlsxwriter; print(json.dumps({"version": platform.python_version(), "sitePackages": str(pathlib.Path(pptx.__file__).parent.parent), "packages": {n: m.version(n) for n in ["python-pptx", "Pillow", "lxml", "XlsxWriter", "typing-extensions"]}}))',
        ],
        { timeout: 10_000, windowsHide: true },
      );
      return { ...JSON.parse(stdout), executable } as BundledPythonInfo;
    } catch {
      return undefined;
    }
  })();
  return infoPromise;
}

export async function getPythonEnvironment(): Promise<string> {
  return formatPythonEnvironment(await getBundledPythonInfo());
}
