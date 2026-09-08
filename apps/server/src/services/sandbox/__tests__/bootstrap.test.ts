import { SANDBOX_UPLOADED_FILES_DIR } from '@lobechat/builtin-tool-cloud-sandbox';
import { describe, expect, it } from 'vitest';

import { buildSandboxFilesInitCommand, SANDBOX_FILES_INIT_MARKER } from '../bootstrap';

describe('buildSandboxFilesInitCommand', () => {
  it('only ensures the dir when there is nothing to download', () => {
    expect(buildSandboxFilesInitCommand([])).toBe(`mkdir -p '${SANDBOX_UPLOADED_FILES_DIR}'`);
  });

  it('uses per-file version markers and validates size before registering success', () => {
    const command = buildSandboxFilesInitCommand([
      { id: 'a', name: 'data.csv', size: 42, version: 'v1', url: 'https://files.example.com/a' },
    ]);
    expect(command).not.toContain(SANDBOX_FILES_INIT_MARKER);
    expect(command).toContain('/mnt/data/file-a/data.csv');
    expect(command).toContain('wc -c');
    expect(command).toContain('&& touch');
    expect(command).toContain('|| exit 1');
    expect(command).not.toContain('|| true');
  });

  it('keeps same-name files in distinct ID directories and reconsiders new versions', () => {
    const command = buildSandboxFilesInitCommand([
      { id: 'a', name: 'data.csv', url: 'https://files/a' },
      { id: 'b', name: 'data.csv', url: 'https://files/b' },
    ]);
    expect(command.split('curl ').length - 1).toBe(2);
    expect(
      buildSandboxFilesInitCommand([
        { id: 'a', name: 'data.csv', version: 'v1', url: 'https://files/a' },
      ]),
    ).not.toBe(
      buildSandboxFilesInitCommand([
        { id: 'a', name: 'data.csv', version: 'v2', url: 'https://files/a' },
      ]),
    );
  });

  it('skips entries without a download url', () => {
    const command = buildSandboxFilesInitCommand([{ name: 'data.csv', url: '' }]);
    expect(command).toBe(`mkdir -p '${SANDBOX_UPLOADED_FILES_DIR}'`);
  });

  it('escapes single quotes in names and urls', () => {
    const command = buildSandboxFilesInitCommand([{ name: "o'brien.txt", url: "https://x/a'b" }]);

    expect(command).toContain(String.raw`o'\''brien.txt`);
    expect(command).toContain(String.raw`'https://x/a'\''b'`);
  });
});
