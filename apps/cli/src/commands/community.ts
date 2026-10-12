import type { Command } from 'commander';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import glob from 'fast-glob';
import { zipSync, unzipSync } from 'fflate';

import { getTrpcClient } from '../api/client';
import { printTable } from '../utils/format';

type Metadata = {
  identifier?: string;
  name?: string;
  description?: string;
  category?: string;
  version?: string;
};
type Options = Metadata & { json?: boolean; dryRun?: boolean };
type Result = {
  file: string;
  identifier?: string;
  status: 'submitted' | 'prepared' | 'failed';
  error?: string;
};
type Resource = {
  type: 'mcp' | 'skill';
  identifier: string;
  name: string;
  description: string;
  version: string;
  category?: string;
  connection?: { url: string; headers: Record<string, string> };
  artifactBase64?: string;
};

function environmentValue(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    if (!process.env[name]) throw new Error(`Environment variable ${name} is required`);
    return process.env[name]!;
  });
}
function metadata(identifier: string, options: Metadata) {
  return {
    identifier: options.identifier || identifier,
    name: options.name || identifier,
    description: options.description || '',
    category: options.category,
    version: options.version || '1.0.0',
  };
}
async function mcpResources(
  file: string,
  options: Metadata,
  results: Result[],
): Promise<Resource[]> {
  const json = JSON.parse(await readFile(file, 'utf8'));
  const entries = Object.entries(json.mcpServers || {});
  if (!entries.length) throw new Error('Expected a non-empty mcpServers configuration');
  if (entries.length > 1 && options.identifier)
    throw new Error('--identifier requires a single MCP server');
  return entries.flatMap(([identifier, config]): Resource[] => {
    try {
      const connection = config as {
        type?: string;
        url?: string;
        headers?: Record<string, string>;
      };
      if (connection.type && connection.type !== 'http')
        throw new Error('Only Streamable HTTP MCP is supported');
      const url = new URL(connection.url || '');
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('MCP URL must use HTTP(S)');
      return [
        {
          type: 'mcp',
          ...metadata(identifier, options),
          connection: {
            url: connection.url!,
            headers: Object.fromEntries(
              Object.entries(connection.headers || {}).map(([key, value]) => [
                key,
                environmentValue(value),
              ]),
            ),
          },
        },
      ];
    } catch (error) {
      results.push({ file, identifier, status: 'failed', error: safeError(error) });
      return [];
    }
  });
}
async function skillResources(file: string, options: Metadata): Promise<Resource[]> {
  const info = await stat(file);
  let bytes: Buffer;
  if (info.isDirectory()) {
    const files: Record<string, Uint8Array> = {};
    const paths = await glob('**/*', {
      cwd: file,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: ['**/.git/**', '**/node_modules/**'],
    });
    for (const name of paths) files[name] = await readFile(path.join(file, name));
    if (!files['SKILL.md']?.length)
      throw new Error('Skill directory must contain non-empty SKILL.md');
    bytes = Buffer.from(zipSync(files));
  } else bytes = await readFile(file);
  if (!bytes.length || bytes.length > 16 * 1024 * 1024)
    throw new Error('Skill ZIP must be between 1 byte and 16 MiB');
  if (!unzipSync(bytes, { filter: (entry) => entry.name === 'SKILL.md' })['SKILL.md']?.length)
    throw new Error('Skill ZIP must contain non-empty SKILL.md at its root');
  const identifier = path.basename(path.resolve(file)).replace(/\.zip$/i, '');
  return [
    { type: 'skill', ...metadata(identifier, options), artifactBase64: bytes.toString('base64') },
  ];
}
function safeError(error: unknown, resource?: Resource) {
  if (error instanceof SyntaxError)
    return 'Invalid JSON; check the MCP configuration or batch manifest';
  let message = error instanceof Error ? error.message : String(error);
  const secrets = [
    process.env.LOBEHUB_CLI_API_KEY,
    ...Object.values(resource?.connection?.headers || {}).flatMap((value) => [
      value,
      value.replace(/^Bearer\s+/i, ''),
    ]),
  ];
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, '[redacted]');
  return message;
}
async function submit(file: string, resources: Resource[], options: Options, results: Result[]) {
  for (const resource of resources) {
    try {
      if (!options.dryRun)
        await (await getTrpcClient()).admin.createCatalogResource.mutate(resource);
      results.push({
        file,
        identifier: resource.identifier,
        status: options.dryRun ? 'prepared' : 'submitted',
      });
    } catch (error) {
      results.push({
        file,
        identifier: resource.identifier,
        status: 'failed',
        error: safeError(error, resource),
      });
    }
  }
}
function output(results: Result[], options: Options) {
  const failed = results.filter((item) => item.status === 'failed').length;
  if (options.json)
    console.log(
      JSON.stringify({
        results,
        failed,
        submitted: results.filter((item) => item.status === 'submitted').length,
      }),
    );
  else
    printTable(
      results.map((item) => [item.file, item.identifier || '', item.status, item.error || '']),
      ['FILE', 'IDENTIFIER', 'STATUS', 'ERROR'],
    );
  if (failed) process.exitCode = 1;
}
function addOptions(command: Command) {
  return command
    .option('--identifier <identifier>', 'Resource identifier (single resource only)')
    .option('--name <name>', 'Display name')
    .option('--description <description>', 'Description')
    .option('--category <category>', 'Category')
    .option('--version <version>', 'Version', '1.0.0')
    .option('--dry-run', 'Prepare locally without submitting or contacting the server')
    .option('--json', 'Output per-resource results as JSON');
}
export function registerCommunityCommand(program: Command) {
  const imports = program
    .command('community')
    .description('Submit MCP and Skills to community review')
    .command('import');
  for (const type of ['mcp', 'skill'] as const)
    addOptions(
      imports
        .command(`${type} <file>`)
        .description(
          type === 'mcp'
            ? 'Submit mcpServers JSON for review'
            : 'Submit a Skill ZIP or directory for review',
        ),
    ).action(async (file: string, options: Options) => {
      const results: Result[] = [];
      try {
        await submit(
          file,
          await (type === 'mcp'
            ? mcpResources(file, options, results)
            : skillResources(file, options)),
          options,
          results,
        );
      } catch (error) {
        results.push({ file, status: 'failed', error: safeError(error) });
      }
      output(results, options);
    });
  imports
    .command('batch <file>')
    .description('Submit a JSON resources list; paths are relative to the list file')
    .option('--dry-run', 'Prepare locally without submitting or contacting the server')
    .option('--json', 'Output per-resource results as JSON')
    .action(async (file: string, options: Options) => {
      const results: Result[] = [];
      try {
        const batch = JSON.parse(await readFile(file, 'utf8'));
        if (!Array.isArray(batch.resources) || !batch.resources.length)
          throw new Error('Expected a non-empty resources list');
        for (const item of batch.resources) {
          let source = file;
          try {
            if (!['mcp', 'skill'].includes(item.type) || typeof item.path !== 'string')
              throw new Error('Each resource requires type (mcp or skill) and path');
            source = path.resolve(path.dirname(file), item.path);
            const resources = await (item.type === 'mcp'
              ? mcpResources(source, item, results)
              : skillResources(source, item));
            await submit(source, resources, options, results);
          } catch (error) {
            results.push({ file: source, status: 'failed', error: safeError(error) });
          }
        }
      } catch (error) {
        results.push({ file, status: 'failed', error: safeError(error) });
      }
      output(results, options);
    });
}
