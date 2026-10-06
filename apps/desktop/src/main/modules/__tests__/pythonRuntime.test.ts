import { describe, expect, it } from 'vitest';

import { formatPythonEnvironment } from '../pythonRuntime';

describe('bundled Python agent context', () => {
  it('provides the quoted executable and importable preinstalled packages', () => {
    const context = formatPythonEnvironment({
      executable: '/Applications/Masterino Test.app/Contents/Resources/python-runtime/bin/python3',
      sitePackages: '/app/python-runtime/lib/python3.12/site-packages',
      version: '3.12.14',
      venvRoot: '/User Data/python-environments',
      packages: {
        'python-pptx': '1.0.2',
        'Pillow': '12.3.0',
        'lxml': '6.1.3',
        'XlsxWriter': '3.2.9',
        'typing-extensions': '4.16.0',
      },
    });
    expect(context).toContain(
      '"/Applications/Masterino Test.app/Contents/Resources/python-runtime/bin/python3"',
    );
    expect(context).toContain('Python 3.12.14');
    expect(context).toContain('/app/python-runtime/lib/python3.12/site-packages');
    expect(context).toContain('-I -B -X utf8');
    expect(context).toContain('-m venv --without-pip --system-site-packages');
    expect(context).toContain('/User Data/python-environments/project-env');
    expect(context).not.toContain('-m pip for package management');
    expect(context).not.toContain('prioritizes this interpreter directory on PATH');
    expect(context).toContain('-B');
    expect(context).toContain('python-pptx==1.0.2 (import pptx)');
    expect(context).toContain('Pillow==12.3.0 (import PIL)');
    expect(context).toContain('lxml==6.1.3');
    expect(context).toContain('XlsxWriter==3.2.9 (import xlsxwriter)');
    expect(context).toContain('typing-extensions==4.16.0 (import typing_extensions)');
    expect(context).toContain('already verified by the application at startup');
    expect(context).toContain('do not run extra discovery or import probes');
  });

  it('does not advertise an interpreter when the runtime is unavailable', () => {
    expect(formatPythonEnvironment(undefined)).toContain('unavailable');
    expect(formatPythonEnvironment(undefined)).not.toContain('python3');
  });
});
