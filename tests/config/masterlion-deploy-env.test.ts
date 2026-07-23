// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = process.cwd();
const deployDir = path.join(root, 'docker-compose', 'deploy');

const readDeployServiceEnv = async () => {
  const composeText = await readFile(path.join(deployDir, 'docker-compose.yml'), 'utf8');
  const compose = parse(composeText);
  return compose.services.masterlion.environment as string[];
};

const readRustfsDiagnosticCompose = async () => {
  const composeText = await readFile(path.join(deployDir, 'docker-compose.rustfs.yml'), 'utf8');
  return parse(composeText);
};

describe('Masterino deploy environment', () => {
  it('passes file-analysis configuration into the app container', async () => {
    const environment = await readDeployServiceEnv();

    expect(environment).toContain(
      'DEFAULT_FILES_CONFIG=${DEFAULT_FILES_CONFIG:?Set DEFAULT_FILES_CONFIG to the Aihub embedding model, for example embedding_model=newapi/YOUR_AIHUB_EMBEDDING_MODEL,query_mode=full_text}',
    );
    expect(environment).toContain('CHUNKS_AUTO_EMBEDDING=${CHUNKS_AUTO_EMBEDDING:-1}');
  });

  it('provides an opt-in RustFS diagnostic override without changing the default storage backend', async () => {
    const compose = await readRustfsDiagnosticCompose();
    const masterlionEnv = compose.services.masterlion.environment as string[];

    expect(compose.services.rustfs.image).toContain('rustfs/rustfs');
    expect(compose.services['rustfs-init'].command.join('\n')).toContain('mc mb');
    expect(masterlionEnv).toContain('S3_ENDPOINT=http://rustfs:9000');
    expect(masterlionEnv).toContain('S3_BUCKET=${RUSTFS_BUCKET:-masterlion-diagnostic}');
    expect(masterlionEnv).toContain('S3_ENABLE_PATH_STYLE=1');
    expect(masterlionEnv).toContain('S3_SET_ACL=0');
  });
});
