import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { app } from 'electron';

const PROTOCOL_VERSION = 1;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export const pptWorkerPath = () =>
  path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    app.isPackaged ? 'ppt-runtime' : 'resources/ppt-runtime',
    'ppt-worker',
    process.platform === 'win32' ? 'ppt-worker.exe' : 'ppt-worker',
  );

const callWorker = async (command: 'health' | 'inspect' | 'apply', payload?: object) => {
  const binary = pptWorkerPath();
  return new Promise<Record<string, any>>((resolve, reject) => {
    const child = spawn(binary, [command], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let diagnostic = '';
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    };
    const timeout = setTimeout(
      () => fail(new Error('PRESENTATION_WORKER_TIMEOUT')),
      command === 'apply' ? 120_000 : 30_000,
    );
    child.on('error', fail);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > MAX_RESPONSE_BYTES)
        fail(new Error('PRESENTATION_WORKER_RESPONSE_TOO_LARGE'));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      diagnostic = (diagnostic + chunk).slice(-2048);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        const result = JSON.parse(output);
        if (code !== 0 || result.error)
          throw new Error(result.error ?? `PRESENTATION_WORKER_FAILED: ${diagnostic}`);
        if (result.protocolVersion !== PROTOCOL_VERSION)
          throw new Error('PRESENTATION_WORKER_VERSION_MISMATCH');
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
};

export const isPythonPptWorkerAvailable = async () => {
  try {
    const response = await callWorker('health');
    return response.pythonPptx === true;
  } catch {
    return false;
  }
};

const sha256 = async (file: string) =>
  createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');

export interface InspectExistingPresentationParams {
  path: string;
  expectedSha256?: string;
  slideIndices?: number[];
}

export interface EditExistingPresentationParams {
  path: string;
  outputPath: string;
  expectedSha256: string;
  operations: object[];
}

export const inspectExistingPresentation = async (params: InspectExistingPresentationParams) => {
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'masterino-ppt-inspect-'));
  try {
    const snapshot = path.join(snapshotDir, 'source.pptx');
    await fs.copyFile(params.path, snapshot);
    const hash = await sha256(snapshot);
    if (params.expectedSha256 && hash !== params.expectedSha256)
      throw new Error('PRESENTATION_SOURCE_CHANGED');
    if (hash !== (await sha256(params.path))) throw new Error('PRESENTATION_SOURCE_CHANGED');
    return await callWorker('inspect', {
      path: snapshot,
      expectedSha256: hash,
      slideIndices: params.slideIndices,
    });
  } finally {
    await fs.rm(snapshotDir, { recursive: true, force: true });
  }
};

export const editExistingPresentation = async (params: EditExistingPresentationParams) => {
  if (path.extname(params.outputPath).toLowerCase() !== '.pptx')
    throw new Error('PRESENTATION_INVALID_PATH');
  if (!/^[0-9a-f]{64}$/.test(params.expectedSha256))
    throw new Error('PRESENTATION_EXPECTED_HASH_REQUIRED');
  if (path.resolve(params.path) === path.resolve(params.outputPath))
    throw new Error('PRESENTATION_OUTPUT_EXISTS');
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'masterino-ppt-edit-'));
  const tempOutput = path.join(
    path.dirname(params.outputPath),
    `.${path.basename(params.outputPath)}.${randomUUID()}.tmp.pptx`,
  );
  try {
    const snapshot = path.join(snapshotDir, 'source.pptx');
    await fs.copyFile(params.path, snapshot);
    if (
      (await sha256(snapshot)) !== params.expectedSha256 ||
      (await sha256(params.path)) !== params.expectedSha256
    ) {
      throw new Error('PRESENTATION_SOURCE_CHANGED');
    }
    const result = await callWorker('apply', {
      path: snapshot,
      outputPath: tempOutput,
      expectedSha256: params.expectedSha256,
      operations: params.operations,
    });
    const verification = await callWorker('inspect', { path: tempOutput });
    if (verification.sha256 !== result.sha256 || verification.totalSlides !== result.slides) {
      throw new Error('PRESENTATION_OUTPUT_VALIDATION_FAILED');
    }
    await fs.link(tempOutput, params.outputPath);
    return { ...result, outputPath: params.outputPath };
  } finally {
    await fs.rm(tempOutput, { force: true });
    await fs.rm(snapshotDir, { recursive: true, force: true });
  }
};
