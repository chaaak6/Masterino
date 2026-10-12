import { Command } from 'commander';
import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile, rm, mkdir, truncate } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { unzipSync, zipSync, strToU8 } from 'fflate';

import { registerCommunityCommand } from './community';

let server: Server;
let folder: string;
const requests: Array<{ input: any; key: string | undefined }> = [];
const originalEnv = { server: process.env.LOBEHUB_SERVER, key: process.env.LOBEHUB_CLI_API_KEY };
function program() {
  const p = new Command();
  registerCommunityCommand(p);
  return p;
}
async function run(args: string[]) {
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await program().parseAsync(['node', 'lh', 'community', 'import', ...args, '--json']);
    return JSON.parse(output.mock.calls.at(-1)![0]);
  } finally {
    output.mockRestore();
  }
}
beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'community-cli-'));
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body).json;
    requests.push({ input, key: req.headers['x-api-key'] as string });
    res.setHeader('Content-Type', 'application/json');
    if (['duplicate', 'secret-error'].includes(input.identifier)) {
      res.statusCode = 409;
      res.end(
        JSON.stringify({
          error: {
            json: {
              message:
                input.identifier === 'secret-error'
                  ? 'Authentication rejected: third-party-secret'
                  : 'Resource already exists',
              code: -32009,
              data: { code: 'CONFLICT', httpStatus: 409 },
            },
          },
        }),
      );
    } else
      res.end(
        JSON.stringify({
          result: { data: { json: { identifier: input.identifier, workflowState: 'submitted' } } },
        }),
      );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  process.env.LOBEHUB_SERVER = `http://127.0.0.1:${address.port}`;
  process.env.LOBEHUB_CLI_API_KEY = 'cli-test-access-key';
});
afterEach(() => {
  requests.length = 0;
  process.exitCode = 0;
  delete process.env.COMMUNITY_TEST_MCP_KEY;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(folder, { recursive: true, force: true });
  if (originalEnv.server === undefined) delete process.env.LOBEHUB_SERVER;
  else process.env.LOBEHUB_SERVER = originalEnv.server;
  if (originalEnv.key === undefined) delete process.env.LOBEHUB_CLI_API_KEY;
  else process.env.LOBEHUB_CLI_API_KEY = originalEnv.key;
});
describe('community import BDD', () => {
  it('Given a small ZIP with an oversized expanded SKILL.md, Then CLI rejects it before unpacking', async () => {
    const file = path.join(folder, 'oversized-expanded.zip');
    await writeFile(file, Buffer.from(zipSync({ 'SKILL.md': new Uint8Array(26 * 1024 * 1024) })));
    const result = await run(['skill', file, '--dry-run']);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain('25 MiB');
    expect(requests).toHaveLength(0);
  });

  it('Given an oversized source file, Then directory import rejects it before compression', async () => {
    const dir = path.join(folder, 'oversized-source');
    await mkdir(dir);
    await writeFile(path.join(dir, 'SKILL.md'), '---\nname: example\ndescription: test\n---');
    await writeFile(path.join(dir, 'large.bin'), '');
    await truncate(path.join(dir, 'large.bin'), 26 * 1024 * 1024);
    const result = await run(['skill', dir]);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain('25 MiB');
    expect(requests).toHaveLength(0);
  });
  it('Given a source directory beyond the unpacked limit, Then import rejects its total size', async () => {
    const dir = path.join(folder, 'oversized-directory');
    await mkdir(dir);
    await writeFile(path.join(dir, 'SKILL.md'), '---\nname: example\ndescription: test\n---');
    for (let i = 0; i < 5; i++) {
      const file = path.join(dir, `resource-${i}.bin`);
      await writeFile(file, '');
      await truncate(file, 21 * 1024 * 1024);
    }
    const result = await run(['skill', dir]);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain('100 MiB');
    expect(requests).toHaveLength(0);
  });

  it('Given malformed JSON containing a pasted credential, Then the parser error does not print the input fragment', async () => {
    const file = path.join(folder, 'malformed.json');
    await writeFile(file, 'third-party-secret');
    const result = await run(['mcp', file]);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain('Invalid JSON');
    expect(JSON.stringify(result)).not.toContain('third-party-secret');
    expect(requests).toHaveLength(0);
  });

  it('Given an upstream error containing a Bearer token, Then the token is redacted from results', async () => {
    const file = path.join(folder, 'error.json');
    await writeFile(
      file,
      JSON.stringify({
        mcpServers: {
          'secret-error': {
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer third-party-secret' },
          },
        },
      }),
    );
    const result = await run(['mcp', file]);
    expect(result.failed).toBe(1);
    expect(JSON.stringify(result)).not.toContain('third-party-secret');
    expect(result.results[0].error).toContain('[redacted]');
  });

  it('Given a Skill ZIP and MCP JSON, When dry-run batch is used, Then no requests are sent and each item is prepared', async () => {
    await writeFile(
      path.join(folder, 'packed.zip'),
      zipSync({ 'SKILL.md': strToU8('---\nname: packed\ndescription: test\n---\nRead me.') }),
    );
    await writeFile(
      path.join(folder, 'preview-mcp.json'),
      JSON.stringify({ mcpServers: { preview: { url: 'https://example.com/mcp' } } }),
    );
    const file = path.join(folder, 'preview.json');
    await writeFile(
      file,
      JSON.stringify({
        resources: [
          { type: 'skill', path: 'packed.zip', identifier: 'packed' },
          { type: 'mcp', path: 'preview-mcp.json' },
        ],
      }),
    );
    const result = await run(['batch', file, '--dry-run']);
    expect(result.results.map((item: any) => item.status)).toEqual(['prepared', 'prepared']);
    expect(result.failed).toBe(0);
    expect(requests).toHaveLength(0);
  });
  it('Given an unsupported MCP next to a valid one, Then the valid one is still submitted', async () => {
    const file = path.join(folder, 'mixed.json');
    await writeFile(
      file,
      JSON.stringify({
        mcpServers: {
          unsupported: { type: 'stdio', command: 'npx' },
          supported: { type: 'http', url: 'https://example.com/mcp' },
        },
      }),
    );
    const result = await run(['mcp', file]);
    expect(result.failed).toBe(1);
    expect(result.submitted).toBe(1);
    expect(requests[0].input.identifier).toBe('supported');
  });
  it('Given an unresolved environment variable, Then no submission happens and output does not expose other secrets', async () => {
    const file = path.join(folder, 'unresolved.json');
    await writeFile(
      file,
      JSON.stringify({
        mcpServers: {
          unresolved: {
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer ${COMMUNITY_TEST_MCP_KEY}' },
          },
        },
      }),
    );
    const result = await run(['mcp', file]);
    expect(result.results[0].error).toContain(
      'Environment variable COMMUNITY_TEST_MCP_KEY is required',
    );
    expect(requests).toHaveLength(0);
  });

  it('Given a batch with a duplicate, a missing file and a valid MCP, Then failures do not prevent later submission and the exit code is nonzero', async () => {
    await writeFile(
      path.join(folder, 'batch-mcp.json'),
      JSON.stringify({
        mcpServers: {
          duplicate: { url: 'https://example.com/mcp' },
          good: { url: 'https://example.com/mcp' },
        },
      }),
    );
    const file = path.join(folder, 'batch.json');
    await writeFile(
      file,
      JSON.stringify({
        resources: [
          { type: 'skill', path: 'missing.zip' },
          { type: 'mcp', path: 'batch-mcp.json' },
        ],
      }),
    );
    const result = await run(['batch', file]);
    expect(result.failed).toBe(2);
    expect(result.submitted).toBe(1);
    expect(result.results.at(-1)).toMatchObject({ identifier: 'good', status: 'submitted' });
    expect(process.exitCode).toBe(1);
    expect(requests.map((r) => r.input.identifier)).toEqual(['duplicate', 'good']);
  });

  it('Given a Skill directory with resources, When imported, Then the archive contains SKILL.md and resources and enters review', async () => {
    const dir = path.join(folder, 'my-skill');
    await mkdir(path.join(dir, 'references'), { recursive: true });
    await writeFile(
      path.join(dir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: test\n---\nUse references.',
    );
    await writeFile(path.join(dir, 'references', 'guide.md'), 'reference marker');
    const result = await run(['skill', dir]);
    expect(result.results[0]).toMatchObject({ identifier: 'my-skill', status: 'submitted' });
    const files = unzipSync(Buffer.from(requests[0].input.artifactBase64, 'base64'));
    expect(new TextDecoder().decode(files['references/guide.md'])).toBe('reference marker');
    expect(new TextDecoder().decode(files['SKILL.md'])).toContain('name: my-skill');
  });

  it('Given MCP JSON with an environment Key, When imported, Then it submits for review without printing either Key', async () => {
    process.env.COMMUNITY_TEST_MCP_KEY = 'third-party-secret';
    const file = path.join(folder, 'mcp.json');
    await writeFile(
      file,
      JSON.stringify({
        mcpServers: {
          law: {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer ${COMMUNITY_TEST_MCP_KEY}' },
          },
        },
      }),
    );
    const result = await run(['mcp', file]);
    expect(requests[0]).toMatchObject({
      key: 'cli-test-access-key',
      input: {
        type: 'mcp',
        identifier: 'law',
        connection: { headers: { Authorization: 'Bearer third-party-secret' } },
      },
    });
    expect(result.results[0]).toMatchObject({ identifier: 'law', status: 'submitted' });
    expect(JSON.stringify(result)).not.toContain('third-party-secret');
    expect(JSON.stringify(result)).not.toContain('cli-test-access-key');
  });
});
