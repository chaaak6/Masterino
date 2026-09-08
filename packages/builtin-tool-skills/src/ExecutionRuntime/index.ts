import { AGENT_SKILLS_IDENTIFIER_PREFIX } from '@lobechat/const';
import { formatCommandResult, resourcesTreePrompt } from '@lobechat/prompts';
import type {
  BuiltinServerRuntimeOutput,
  BuiltinSkill,
  SkillItem,
  SkillListItem,
  SkillResourceContent,
} from '@lobechat/types';
import type { ExecutionContext } from '@lobechat/types/src/executionContext';
import type { SkillRef } from '@lobechat/types/src/projectWorkspace';

import type {
  ActivateSkillParams,
  CommandResult,
  ExecScriptParams,
  ExportFileParams,
  ReadReferenceParams,
  RunCommandOptions,
  RunCommandParams,
} from '../types';
import { type DeviceSkillPathVerifier, resolveSkillScriptExecutionRoute } from './skillScriptRoute';

/**
 * Unified skill service interface for dependency injection.
 * On client side, this is implemented by AgentSkillService.
 * On server side, this is composed from AgentSkillModel + SkillResourceService.
 */
export interface SkillImportServiceResult {
  skill: { id: string; name: string };
  status: 'created' | 'updated' | 'unchanged';
}

export interface ExportFileResult {
  fileId?: string;
  filename: string;
  mimeType?: string;
  size?: number;
  success: boolean;
  url?: string;
}

export interface SkillRuntimeService {
  execScript?: (
    command: string,
    options: {
      activatedSkills?: Array<{ description?: string; id: string; name: string }>;
      description: string;
    },
  ) => Promise<CommandResult>;
  exportFile?: (path: string, filename: string) => Promise<ExportFileResult>;
  findAll: () => Promise<{ data: SkillListItem[]; total: number }>;
  findById: (id: string) => Promise<SkillItem | undefined>;
  findByName: (name: string) => Promise<SkillItem | undefined>;
  readResource: (id: string, path: string) => Promise<SkillResourceContent>;
  runCommand?: (options: RunCommandOptions) => Promise<CommandResult>;
}

/**
 * A project-level skill discovered on the device filesystem
 * (`.agents/skills` / `.claude/skills`). The runtime only needs the name to
 * match an `activateSkill`/`readReference` call and the absolute SKILL.md path
 * to read its content. The directory tree is enumerated lazily on activation
 * via `DeviceFileAccess.listFiles` — keeping it out of the op param payload.
 */
export interface ProjectSkillRuntimeItem {
  /** Absolute path to the skill's SKILL.md on the device. */
  location: string;
  key?: string;
  name: string;
}

/**
 * Device filesystem access used to load project skills. The server wires this
 * to the `local-system` tool over the device gateway, so the runtime stays
 * transport-agnostic — it just needs to read/enumerate files on the device.
 */
export interface DeviceFileAccess {
  /**
   * Recursively enumerate files under `dir`, returning POSIX-style paths
   * relative to `dir`. `readReference` validates user-supplied paths against
   * this list so the model can only read files the project skill actually
   * exposes (no hidden files, no escape outside the skill directory).
   */
  listFiles: (dir: string) => Promise<string[]>;
  /** Read a text file's content from the device. */
  readFile: (path: string) => Promise<string>;
}

export interface SkillsExecutionRuntimeOptions {
  /** Server runtimes derive activation from owned conversation history, never model arguments. */
  activatedSkillsResolver?: () => Promise<ExecScriptParams['activatedSkills']>;
  builtinSkills?: BuiltinSkill[];
  /** Reads project skill files from the device (local-system over the gateway). */
  deviceFileAccess?: DeviceFileAccess;
  /** Device execution adapter. Server wiring supplies the gateway implementation. */
  deviceScriptRunner?: (
    command: string,
    options: {
      activatedSkills?: Array<{ description?: string; id: string; name: string }>;
      cwd: string;
      description: string;
      deviceId: string;
      env: Record<string, string>;
    },
  ) => Promise<CommandResult>;
  /** Device-side realpath proof for workspace and skill containment. */
  deviceSkillPathVerifier?: DeviceSkillPathVerifier;
  /** Immutable operation-scoped execution context from the workspace runtime. */
  executionContext?: ExecutionContext;
  /** Project skills discovered on the device filesystem. */
  projectSkills?: ProjectSkillRuntimeItem[];
  /** Registry winners used by prompt assembly for this operation. */
  registryResult?: { skills: SkillRef[] };
  projectSnapshotResolver?: (input: {
    key: string;
    location: string;
    resourcePath?: string;
  }) => Promise<{ directory: string; content: string; files: string[]; resourceContent?: string }>;
  service: SkillRuntimeService;
  /** Resolves a mounted device skill bundle without guessing a host path. */
  skillDirectoryResolver?: (
    activatedSkills: Array<{ description?: string; id: string; name: string }>,
  ) => Promise<string | undefined>;
}

/** Cross-platform dirname for absolute paths (POSIX or Windows separators). */
const getDirname = (filePath: string): string => {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx === -1 ? '' : filePath.slice(0, idx);
};

/** Join a directory with a relative path, preserving the directory's separator. */
const joinPath = (dir: string, rel: string): string => {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const trimmed = dir.endsWith(sep) ? dir.slice(0, -sep.length) : dir;
  return `${trimmed}${sep}${rel}`;
};

/**
 * Normalize a user-supplied relative path to POSIX form: backslashes → `/`,
 * trim leading `./` and slashes. Used to compare requested paths against the
 * skill's `listFiles` result (which is canonicalized the same way by the
 * device-side enumerator) and to detect hidden segments.
 */
const normalizeRelativePath = (rel: string): string =>
  rel
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '');

/** True when any segment in `rel` is hidden (starts with `.`) — `.env`, `.git/...`. */
const hasHiddenSegment = (rel: string): boolean =>
  rel.split('/').some((seg) => seg.startsWith('.'));

/**
 * Hint appended to activated project-skill content so the model knows how to
 * discover the rest of the skill's directory. We deliberately don't enumerate
 * the tree here — the model has `local-system.globFiles` available and can
 * call it on demand, which keeps the op-param payload small.
 */
const buildProjectDirectoryHint = (skillId: string, skillDir: string): string =>
  `## Skill resources

This project skill lives in \`${skillDir}\`. Use \`readReference\` with id=${JSON.stringify(skillId)} and a relative resource path. Use the same skillId when calling execScript. Scripts run from the task working directory; address skill resources through SKILL_DIR and write outputs in WORKSPACE_DIR.`;

export class SkillsExecutionRuntime {
  private builtinSkills: BuiltinSkill[];
  private projectSkills: ProjectSkillRuntimeItem[];
  private registrySkills?: SkillRef[];
  private deviceFileAccess?: DeviceFileAccess;
  private deviceSkillPathVerifier?: DeviceSkillPathVerifier;
  private deviceScriptRunner?: SkillsExecutionRuntimeOptions['deviceScriptRunner'];
  private executionContext?: ExecutionContext;
  private service: SkillRuntimeService;
  private activatedSkillsResolver?: SkillsExecutionRuntimeOptions['activatedSkillsResolver'];
  private projectSnapshotResolver?: SkillsExecutionRuntimeOptions['projectSnapshotResolver'];
  private skillDirectoryResolver?: SkillsExecutionRuntimeOptions['skillDirectoryResolver'];

  constructor(options: SkillsExecutionRuntimeOptions) {
    this.service = options.service;
    this.projectSnapshotResolver = options.projectSnapshotResolver;
    this.builtinSkills = options.builtinSkills || [];
    this.registrySkills = options.registryResult?.skills;
    const registryProjectSkills = (this.registrySkills ?? [])
      .filter(
        (skill): skill is SkillRef & { location: string } =>
          (skill.source === 'project' || skill.source === 'workspace') && !!skill.location,
      )
      .map((skill) => ({ location: skill.location, name: skill.name, key: skill.key }));
    this.projectSkills = [...registryProjectSkills, ...(options.projectSkills || [])].filter(
      (skill, index, all) => all.findIndex(({ name }) => name === skill.name) === index,
    );
    this.deviceFileAccess = options.deviceFileAccess;
    this.deviceSkillPathVerifier = options.deviceSkillPathVerifier;
    this.deviceScriptRunner = options.deviceScriptRunner;
    this.executionContext = options.executionContext;
    this.skillDirectoryResolver = options.skillDirectoryResolver;
    this.activatedSkillsResolver = options.activatedSkillsResolver;
  }

  private async prepareProject(skill: ProjectSkillRuntimeItem, resourcePath?: string) {
    if (this.projectSnapshotResolver)
      return this.projectSnapshotResolver({
        key: skill.key ?? `project:${skill.name}`,
        location: skill.location,
        resourcePath,
      });
    if (this.executionContext) throw new Error('SKILL_SNAPSHOT_UNAVAILABLE');
    // Compatibility for standalone consumers without a bound device runtime.
    return {
      directory: getDirname(skill.location),
      content: await this.deviceFileAccess!.readFile(skill.location),
      files: [] as string[],
      resourceContent: undefined as string | undefined,
    };
  }

  async execScript(args: ExecScriptParams): Promise<BuiltinServerRuntimeOutput> {
    const { command, description } = args;
    let activatedSkills = this.activatedSkillsResolver
      ? await this.activatedSkillsResolver()
      : args.activatedSkills;

    // History is evidence of activation, never authority to select another
    // source by name. Resolve before any bundle preparation or execution.
    if (this.registrySkills) {
      const selected = args.skillId
        ? activatedSkills?.filter((skill) => skill.id === args.skillId)
        : activatedSkills;
      const identities = [...new Set(selected?.map((skill) => skill.id) ?? [])];
      const ref =
        identities.length === 1
          ? this.registrySkills.find((skill) => skill.key === identities[0])
          : undefined;
      if (!ref)
        return {
          content:
            'Select and activate one currently available skill, then pass its returned skillId.',
          state: { errorCode: 'SKILL_ACTIVATION_REQUIRED' },
          success: false,
        };
      // Existing bundle services consume database IDs; translate only after
      // validating the stable registry identity, never in the history reader.
      const userSkill = ref.source === 'user' ? await this.loadUserSkill(ref) : undefined;
      if (ref.source === 'user' && !userSkill)
        return {
          content: 'The activated skill resource is no longer available.',
          success: false,
        };
      activatedSkills = [
        { id: userSkill?.id ?? ref.key, name: ref.name, description: ref.description },
      ];
    }

    if (this.executionContext) {
      let projectSkill: (typeof this.projectSkills)[number] | undefined;
      let skillDir: string | undefined;
      // Activation history contains builtins and document-only skills as well.
      // Resolve the most recently activated executable skill, across both origins.
      try {
        for (const activated of [...(activatedSkills ?? [])].reverse()) {
          projectSkill = this.projectSkills.find((skill) =>
            skill.key
              ? skill.key === activated.id
              : !this.registrySkills && skill.name === activated.name,
          );
          skillDir = projectSkill
            ? (await this.prepareProject(projectSkill)).directory
            : await this.skillDirectoryResolver?.([activated]);
          if (skillDir) break;
        }
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), success: false };
      }
      const route = await resolveSkillScriptExecutionRoute({
        allowExternalSkillDir: !projectSkill || !!this.projectSnapshotResolver,
        context: this.executionContext,
        skillDir,
        verifyDevicePaths: this.deviceSkillPathVerifier,
      });

      if (!route.ok) {
        return {
          content: route.error.message,
          state: { errorCode: route.error.code },
          success: false,
        };
      }

      if (route.kind === 'device') {
        if (!this.deviceScriptRunner) {
          return {
            content: 'Device skill script execution is not wired in this environment.',
            success: false,
          };
        }
        try {
          const result = await this.deviceScriptRunner(command, {
            activatedSkills,
            cwd:
              projectSkill && this.projectSnapshotResolver ? this.executionContext.cwd! : route.cwd,
            description,
            deviceId: route.deviceId,
            env: route.env,
          });
          return this.formatCommandOutput(command, result);
        } catch (error) {
          return {
            content: `Failed to execute command: ${(error as Error).message}`,
            success: false,
          };
        }
      }
      // Sandbox intentionally falls through to the existing service call so its
      // provider-owned mount path and behavior remain unchanged.
    }

    // Try new execScript method first (with cloud sandbox support)
    if (this.service.execScript) {
      try {
        const result = await this.service.execScript(command, {
          activatedSkills,
          description,
        });

        return this.formatCommandOutput(command, result);
      } catch (e) {
        return {
          content: `Failed to execute command: ${(e as Error).message}`,
          success: false,
        };
      }
    }

    // Fallback to legacy runCommand method
    if (!this.service.runCommand) {
      return {
        content: 'Command execution is not available in this environment.',
        success: false,
      };
    }

    try {
      const result = await this.service.runCommand({ command });
      return this.formatCommandOutput(command, result);
    } catch (e) {
      return {
        content: `Failed to execute command: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async runCommand(args: RunCommandParams): Promise<BuiltinServerRuntimeOutput> {
    const { command } = args;

    if (this.executionContext) {
      const { plan } = this.executionContext;
      if (plan.kind === 'none') {
        return {
          content: 'A workspace is required to run a skill command.',
          state: { errorCode: 'WORKSPACE_REQUIRED' },
          success: false,
        };
      }
      if (plan.kind === 'device-unrouted') {
        return {
          content: 'The selected device is unavailable for skill command execution.',
          state: { errorCode: 'DEVICE_UNROUTED' },
          success: false,
        };
      }
      if (plan.kind === 'device') {
        const cwd = this.executionContext.workspace?.rootPath ?? this.executionContext.cwd;
        if (!cwd || !this.deviceScriptRunner) {
          return {
            content: 'Device skill command execution is not wired in this environment.',
            state: { errorCode: 'WORKSPACE_REQUIRED' },
            success: false,
          };
        }
        try {
          const result = await this.deviceScriptRunner(command, {
            cwd,
            description: args.description ?? 'Run skill command',
            deviceId: plan.deviceId,
            env: {
              ...this.executionContext.env?.values,
              WORKSPACE_DIR: cwd,
            },
          });
          return this.formatCommandOutput(command, result);
        } catch (error) {
          return {
            content: `Failed to execute command: ${(error as Error).message}`,
            success: false,
          };
        }
      }
      // Sandbox intentionally keeps using its provider-owned service below.
    }

    if (!this.service.runCommand) {
      return {
        content: 'Command execution is not available in this environment.',
        success: false,
      };
    }

    try {
      const result = await this.service.runCommand({ command });
      return this.formatCommandOutput(command, result);
    } catch (e) {
      return {
        content: `Failed to execute command: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async exportFile(args: ExportFileParams): Promise<BuiltinServerRuntimeOutput> {
    const { path, filename } = args;

    if (this.executionContext) {
      const { plan } = this.executionContext;
      if (plan.kind === 'device') {
        return {
          content: `The file is already on the device at ${path}`,
          state: { filename, path },
          success: true,
        };
      }
      if (plan.kind !== 'sandbox') {
        return {
          content:
            plan.kind === 'device-unrouted'
              ? 'The selected device is unavailable for file export.'
              : 'A workspace is required to export a skill file.',
          state: {
            errorCode: plan.kind === 'device-unrouted' ? 'DEVICE_UNROUTED' : 'WORKSPACE_REQUIRED',
          },
          success: false,
        };
      }
    }

    if (!this.service.exportFile) {
      return {
        content: 'File export is not available in this environment.',
        success: false,
      };
    }

    try {
      const result = await this.service.exportFile(path, filename);

      if (!result.success) {
        return {
          content: `Failed to export file: ${filename}`,
          success: false,
        };
      }

      return {
        content: `File exported successfully: ${filename}\nDownload URL: ${result.url || 'N/A'}`,
        state: {
          fileId: result.fileId,
          filename: result.filename,
          mimeType: result.mimeType,
          size: result.size,
          url: result.url,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to export file: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async readReference(args: ReadReferenceParams): Promise<BuiltinServerRuntimeOutput> {
    const { path } = args;

    try {
      const registryRef = this.resolveRegistrySkill(args.id);
      const id = registryRef?.name ?? args.id;
      if (this.registrySkills && !registryRef) {
        return { content: `Skill not found: "${id}"`, success: false };
      }
      // Project skills resolve references relative to the SKILL.md directory,
      // read through the device file access (local-system over the gateway).
      const projectSkill =
        !registryRef || registryRef.source === 'project' || registryRef.source === 'workspace'
          ? this.projectSkills.find((s) => s.name === id)
          : undefined;
      if (projectSkill) {
        if (!this.deviceFileAccess) {
          return {
            content: `Project skill "${id}" cannot be read: no device file access available.`,
            success: false,
          };
        }

        // Normalize and reject obviously-unsafe shapes up front. The
        // `listFiles` membership check below is the real authority, but
        // failing fast here keeps the error message specific.
        const normalized = normalizeRelativePath(path);
        if (!normalized || normalized.includes('..') || hasHiddenSegment(normalized)) {
          return {
            content: `Invalid path: "${path}" is not a permitted skill resource`,
            success: false,
          };
        }

        // Enumerate the skill directory and only allow files the device
        // surface advertises. Without this, a model could request any path
        // under the skill dir (e.g. `.env`, `node_modules/…`) that was never
        // declared as a skill resource. The device-side enumerator already
        // filters hidden files; we re-check here as defense in depth.
        if (this.projectSnapshotResolver) {
          const snapshot = await this.prepareProject(projectSkill, normalized);
          return {
            content: snapshot.resourceContent ?? '',
            state: {
              encoding: 'utf8',
              fileType: 'text/plain',
              fullPath: joinPath(snapshot.directory, normalized),
              path: normalized,
            },
            success: true,
          };
        }
        if (this.executionContext) throw new Error('SKILL_SNAPSHOT_UNAVAILABLE');
        const skillDir = getDirname(projectSkill.location);
        const allowed = new Set(
          (await this.deviceFileAccess.listFiles(skillDir)).map((f) => normalizeRelativePath(f)),
        );
        if (!allowed.has(normalized)) {
          return {
            content: `Resource not found in project skill "${id}": "${path}"`,
            success: false,
          };
        }

        const fullPath = joinPath(skillDir, normalized);
        const content = await this.deviceFileAccess.readFile(fullPath);
        return {
          content,
          state: { encoding: 'utf8', fileType: 'text/plain', fullPath, path: normalized },
          success: true,
        };
      }

      // For non-project skills, keep the traversal guard. Builtin / user
      // skills look paths up via an explicit `resources` map or service, so
      // the `..` substring is the only realistic traversal vector.
      if (path.includes('..')) {
        return {
          content: 'Invalid path: path traversal is not allowed',
          success: false,
        };
      }

      // DB (user-level) skills win over builtins on name collision — matches
      // the `<available_skills>` dedupe precedence (project > user > agent >
      // builtin) in `aiAgent/index.ts`. Without this, the model would see a
      // user skill in the list but `readReference` would silently read the
      // shadowed builtin's resources.
      const skill =
        !registryRef || registryRef.source === 'user'
          ? registryRef
            ? await this.loadUserSkill(registryRef)
            : await this.service.findByName(id)
          : undefined;
      if (skill) {
        const resource = await this.service.readResource(skill.id, path);
        return {
          content: resource.content,
          state: {
            encoding: resource.encoding,
            fileType: resource.fileType,
            fullPath: resource.fullPath,
            path: resource.path,
            size: resource.size,
          },
          success: true,
        };
      }

      // Fall back to builtin skills (includes agent-document skill bundles
      // via the `agent-skills:` identifier prefix).
      const builtinSkill =
        !registryRef || registryRef.source === 'builtin' || registryRef.source === 'agent'
          ? this.builtinSkills.find(
              (skill) => skill.identifier === registryRef?.identifier || skill.name === id,
            )
          : undefined;
      if (builtinSkill?.resources) {
        const meta = builtinSkill.resources[path];
        if (meta?.content !== undefined) {
          return {
            content: meta.content,
            state: {
              encoding: 'utf8',
              fileType: 'text/plain',
              path,
              size: meta.size,
            },
            success: true,
          };
        }
        return {
          content: `Resource not found: "${path}" in builtin skill "${id}"`,
          success: false,
        };
      }

      return {
        content: `Skill not found: "${id}"`,
        success: false,
      };
    } catch (e) {
      return {
        content: `Failed to read resource: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async activateSkill(args: ActivateSkillParams): Promise<BuiltinServerRuntimeOutput> {
    const registryRef = this.resolveRegistrySkill(args.name);
    const name = registryRef?.name ?? args.name;
    if (registryRef?.source === 'agent' && registryRef.content !== undefined) {
      return {
        content: registryRef.content,
        state: {
          id: registryRef.key,
          name: registryRef.name,
          identifier: registryRef.identifier,
          source: 'agent',
          description: registryRef.description,
          hasResources: false,
        },
        success: true,
      };
    }
    if (this.registrySkills && !registryRef) {
      const availableSkills = this.registrySkills.map((skill) => ({
        description: skill.description,
        name: skill.name,
      }));
      return {
        content: `Skill not found: "${name}". Available skills: ${JSON.stringify(availableSkills)}`,
        success: false,
      };
    }

    // Project skills (filesystem SKILL.md) take precedence over db/builtin.
    const projectSkill =
      !registryRef || registryRef.source === 'project' || registryRef.source === 'workspace'
        ? this.projectSkills.find((s) => s.name === name)
        : undefined;
    if (projectSkill) {
      if (!this.deviceFileAccess) {
        return {
          content: `Project skill "${name}" cannot be loaded: no device file access available.`,
          success: false,
        };
      }

      try {
        const snapshot = await this.prepareProject(projectSkill);
        let content = snapshot.content;

        // Don't enumerate the directory here — let the model do it on demand
        // via `local-system.globFiles`. Just point at the skill's directory so
        // it knows where to look. Keeps the op-param payload small and avoids
        // a second deviceGateway round-trip at activation time.
        const skillDir = snapshot.directory;
        if (skillDir) {
          content +=
            '\n\n' + buildProjectDirectoryHint(registryRef?.key ?? `project:${name}`, skillDir);
        }

        return {
          content,
          state: {
            hasResources: false,
            id: registryRef?.key ?? `project:${name}`,
            location: joinPath(snapshot.directory, 'SKILL.md'),
            name,
            source: 'project',
          },
          success: true,
        };
      } catch (e) {
        return {
          content: `Failed to load project skill "${name}": ${(e as Error).message}`,
          success: false,
        };
      }
    }

    // DB (user-level) skills win over builtins on name collision — matches
    // the `<available_skills>` dedupe precedence (project > user > agent >
    // builtin) in `aiAgent/index.ts`. Without this, the model would see a
    // user skill in the list but `activateSkill` would silently load the
    // shadowed builtin instead.
    const skill =
      !registryRef || registryRef.source === 'user'
        ? registryRef
          ? await this.loadUserSkill(registryRef)
          : await this.service.findByName(name)
        : undefined;
    if (skill) {
      const hasResources = !!(skill.resources && Object.keys(skill.resources).length > 0);
      let content = skill.content || '';

      if (hasResources && skill.resources) {
        content += '\n\n' + resourcesTreePrompt(skill.name, skill.resources);
      }

      return {
        content,
        state: {
          description: skill.description || undefined,
          hasResources,
          id: registryRef?.key ?? `user:${skill.identifier}`,
          name: skill.name,
          source: 'user',
        },
        success: true,
      };
    }

    // Fall back to builtin skills (includes agent-document skill bundles via
    // the `agent-skills:` identifier prefix).
    const builtinSkill =
      !registryRef || registryRef.source === 'builtin' || registryRef.source === 'agent'
        ? this.builtinSkills.find(
            (skill) => skill.identifier === registryRef?.identifier || skill.name === name,
          )
        : undefined;
    if (builtinSkill) {
      let content = builtinSkill.content;
      const hasResources = !!(
        builtinSkill.resources && Object.keys(builtinSkill.resources).length > 0
      );

      if (hasResources && builtinSkill.resources) {
        content += '\n\n' + resourcesTreePrompt(builtinSkill.name, builtinSkill.resources);
      }

      // Agent-document skill bundles flow through the builtin path with the
      // `agent-skills:` prefix on their identifier. Tag the result so the
      // inspector can pick the right label ("Activate Agent Skill") and prefer
      // the friendly `title` over the raw `agent-skills:<filename>` name.
      const isAgentSkill = builtinSkill.identifier.startsWith(AGENT_SKILLS_IDENTIFIER_PREFIX);

      return {
        content,
        state: {
          description: builtinSkill.description,
          hasResources,
          identifier: builtinSkill.identifier,
          id:
            registryRef?.key ?? `${isAgentSkill ? 'agent' : 'builtin'}:${builtinSkill.identifier}`,
          name: builtinSkill.name,
          source: isAgentSkill ? 'agent' : 'builtin',
          ...(builtinSkill.title && { title: builtinSkill.title }),
        },
        success: true,
      };
    }

    const availableSkills = this.registrySkills
      ? this.registrySkills.map((skill) => ({
          description: skill.description,
          name: skill.name,
        }))
      : (await this.service.findAll()).data.map((skill) => ({
          description: skill.description,
          name: skill.name,
        }));

    return {
      content: `Skill not found: "${name}". Available skills: ${JSON.stringify(availableSkills)}`,
      success: false,
    };
  }

  private resolveRegistrySkill(locator: string): SkillRef | undefined {
    const exact = this.registrySkills?.find((skill) => skill.key === locator);
    if (exact) return exact;
    const matches = this.registrySkills?.filter(
      (skill) => skill.name === locator || skill.identifier === locator,
    );
    return matches?.length === 1 ? matches[0] : undefined;
  }

  private async loadUserSkill(ref: SkillRef): Promise<SkillItem | undefined> {
    const entry = (await this.service.findAll()).data.find(
      (skill) => skill.identifier === ref.identifier,
    );
    if (!entry) return undefined;
    const skill = await this.service.findById(entry.id);
    return skill?.identifier === ref.identifier &&
      (ref.zipFileHash === undefined || skill.zipFileHash === ref.zipFileHash)
      ? skill
      : undefined;
  }

  /**
   * Format command result using the shared formatCommandResult from @lobechat/prompts.
   * This ensures consistent content format across all runtimes.
   */
  private formatCommandOutput(command: string, result: CommandResult): BuiltinServerRuntimeOutput {
    const content = formatCommandResult({
      stderr: result.stderr,
      stdout: result.output,
      success: result.success,
      exitCode: result.exitCode,
    });

    return {
      content,
      state: {
        command,
        exitCode: result.exitCode,
        success: result.success,
      },
      success: result.success,
    };
  }
}
