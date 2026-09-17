import fs from 'node:fs';
import path from 'node:path';

import { resolveCliManagedPaths } from '../utils/managedPaths';

export interface TaskEntry {
  agentId?: string;
  agentType: 'hermes' | 'openclaw';
  operationId: string;
  pid: number;
  startedAt: string;
  taskId: string;
  topicId: string;
}

function getRegistryPaths(): { canonical: string; legacy: string } {
  const { legacyStateRoot, stateRoot } = resolveCliManagedPaths();
  return {
    canonical: path.join(stateRoot, 'task-registry.json'),
    legacy: path.join(legacyStateRoot, 'task-registry.json'),
  };
}

function readRegistry(): Record<string, TaskEntry> {
  const { canonical, legacy } = getRegistryPaths();
  for (const filename of [canonical, legacy])
    try {
      return JSON.parse(fs.readFileSync(filename, 'utf8')) as Record<string, TaskEntry>;
    } catch {
      // Try the compatibility location.
    }
  return {};
}

function writeRegistry(entries: Record<string, TaskEntry>): void {
  const { canonical } = getRegistryPaths();
  const dir = path.dirname(canonical);
  fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  fs.writeFileSync(canonical, JSON.stringify(entries, null, 2), { mode: 0o600 });
}

export function saveTask(entry: TaskEntry): void {
  const registry = readRegistry();
  registry[entry.taskId] = entry;
  writeRegistry(registry);
}

export function getTask(taskId: string): TaskEntry | undefined {
  return readRegistry()[taskId];
}

export function removeTask(taskId: string): void {
  const registry = readRegistry();
  delete registry[taskId];
  writeRegistry(registry);
}

export function listTasks(): TaskEntry[] {
  return Object.values(readRegistry());
}
