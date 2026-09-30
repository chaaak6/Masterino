import { describe, expect, it } from 'vitest';

import { formatPythonEnvironment } from '../pythonRuntime';

describe('bundled Python agent context', () => {
  it('provides the quoted executable and importable preinstalled packages', () => {
    const context = formatPythonEnvironment({
      executable: '/Applications/Masterino Test.app/Contents/Resources/python-runtime/bin/python3',
      sitePackages: '/app/python-runtime/lib/python3.12/site-packages',
      version: '3.12.14',
      packages: { 'python-pptx': '1.0.2', 'Pillow': '12.3.0', 'lxml': '6.1.3' },
    });
    expect(context).toContain(
      '"/Applications/Masterino Test.app/Contents/Resources/python-runtime/bin/python3"',
    );
    expect(context).toContain('Python 3.12.14');
    expect(context).toContain('/app/python-runtime/lib/python3.12/site-packages');
    expect(context).toContain('-X utf8');
    expect(context).toContain('-B');
    expect(context).toContain('python-pptx==1.0.2 (import pptx)');
    expect(context).toContain('Pillow==12.3.0 (import PIL)');
    expect(context).toContain('lxml==6.1.3');
  });

  it('does not advertise an interpreter when the runtime is unavailable', () => {
    expect(formatPythonEnvironment(undefined)).toContain('unavailable');
    expect(formatPythonEnvironment(undefined)).not.toContain('python3');
  });
});
