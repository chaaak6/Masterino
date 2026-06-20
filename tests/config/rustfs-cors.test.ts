// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = process.cwd();
const deployDir = path.join(root, 'docker-compose', 'deploy');
const devDir = path.join(root, 'docker-compose', 'dev');

describe('RustFS browser upload CORS configuration', () => {
  it('applies a CORS policy during local RustFS bucket initialization', async () => {
    const composeText = await readFile(path.join(devDir, 'docker-compose.yml'), 'utf8');
    const compose = parse(composeText);
    const initService = compose.services['rustfs-init'];
    const command = Array.isArray(initService.command)
      ? initService.command.join('\n')
      : initService.command;

    expect(command).toContain('cat > /tmp/rustfs-cors.json');
    expect(command).toContain('mc cors set');
    expect(command).toContain('/tmp/rustfs-cors.json');
  });

  it('allows browser PUT preflight from the local MasterLion app', async () => {
    for (const dir of [deployDir, devDir]) {
      const cors = JSON.parse(await readFile(path.join(dir, 'rustfs-cors.json'), 'utf8'));

      expect(cors.CORSRules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            AllowedHeaders: expect.arrayContaining(['*']),
            AllowedMethods: expect.arrayContaining(['GET', 'HEAD', 'PUT']),
            AllowedOrigins: expect.arrayContaining(['http://localhost:3220']),
          }),
        ]),
      );
    }
  });
});
