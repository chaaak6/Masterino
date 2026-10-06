import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
  const venv = path.join(info.venvRoot, '<project-key>');
  const venvPython = path.join(
    venv,
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  return `Python ${info.version}
Executable: "${info.executable}"
Package directory: "${info.sitePackages}"
Preinstalled packages: ${packages}
The application detected this interpreter and the installed package versions when this metadata was requested. This is an availability check, not a PPT round-trip test. For questions about the bundled Python environment, answer from this metadata (including all preinstalled packages); do not run extra discovery or import probes unless the user requests a runtime check or a real execution fails. Respect an existing project environment (.venv, conda, test configuration) and explicit user interpreter choices; use the bundled environment by default for new PPT and Office scripts.
**Temporary working files:** One-off generator/check scripts and disposable intermediate files belong in .masterino-tmp/<topic-id>/ inside the current workspace, never scattered at its root. Use writeFile with temporary=true and a relative file name; the application selects the topic directory and returns the actual path. Use that returned path for edits and execution, with runCommand cwd kept at the workspace root so input and final-output relative paths stay unchanged. If temporary is not exposed in the tool schema, write explicitly inside .masterino-tmp/<unique-task-name>/ using a stable task directory. Reuse scripts when correcting them. Final PPT/XLSX/reports and source code explicitly requested by the user stay at their requested paths. Keep presentation sidecars alongside their PPTX. Do not move existing project code or change skill directories. Do not delete temporary scripts automatically; later turns may need them.
For bundled scripts, use runCommand with runtime="bundled-python", command=<script.py path>, and args=[...]. The application supplies the interpreter and -I -B -X utf8. For an explicit terminal invocation: "${info.executable}" -I -B -X utf8 <script.py>. These packages are already importable; no host Python or PATH changes are needed. Treat the application runtime as read-only: never install or upgrade packages in it, and never use its -m pip to manage dependencies.
For additional packages, create a project-specific virtual environment under "${info.venvRoot}". Bundled-script processes receive MASTERINO_PYTHON_ENVIRONMENT (the application-selected project environment directory) and PIP_CONSTRAINT (an application-written file pinning the preinstalled versions). Read these with os.environ when creating an environment or installing extra packages. For explicit terminal commands, use the first 16 hexadecimal characters of SHA-256 of the absolute project path as <project-key> (for a task without a project, use its absolute workspace path). Replace the placeholder before running this example:
"${info.executable}" -I -B -X utf8 -m venv --without-pip --system-site-packages "${venv}"
Write a bundled-constraints.txt file in that environment listing the exact preinstalled package versions above, one name==version per line. Never upgrade or replace these packages in this managed environment. Then install only with "${venvPython}" -I -B -X utf8 -m pip install --constraint "${path.join(venv, 'bundled-constraints.txt')}" <additional-package>, and run project scripts with that virtual environment's Python and the same flags. The virtual environment inherits the preinstalled packages. Use a distinct environment per project; do not use --user or alter host Python.`;
}

export async function prepareProjectPythonEnvironment(
  info: BundledPythonInfo,
  projectPath: string,
) {
  const key = createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 16);
  const root = path.join(info.venvRoot, key);
  await mkdir(root, { recursive: true });
  const constraints = path.join(root, 'bundled-constraints.txt');
  await writeFile(
    constraints,
    Object.entries(info.packages)
      .map(([name, version]) => `${name}==${version}`)
      .join('\n') + '\n',
  );
  return { MASTERINO_PYTHON_ENVIRONMENT: root, PIP_CONSTRAINT: constraints };
}

let infoPromise: Promise<BundledPythonInfo | undefined> | undefined;

export function getBundledPythonInfo(): Promise<BundledPythonInfo | undefined> {
  const pending = (infoPromise ??= (async () => {
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
      const { stdout } = await promisify(childProcess.execFile)(
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
  })());
  void pending.then((info) => {
    if (!info && infoPromise === pending) infoPromise = undefined;
  });
  return pending;
}

export async function getPythonEnvironment(): Promise<string> {
  return formatPythonEnvironment(await getBundledPythonInfo());
}
