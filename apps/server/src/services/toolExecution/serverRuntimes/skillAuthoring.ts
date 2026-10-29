import {
  SkillAuthoringExecutionRuntime,
  SkillAuthoringIdentifier,
} from '@lobechat/builtin-tool-skill-authoring';

import { deviceGateway } from '@/server/services/deviceGateway';
import { SkillImporter } from '@/server/services/skill/importer';
import { SkillPublishingService } from '@/server/services/skill/publishing';
import {
  createSkillAuthoringRuntimeService,
  type ProjectSkillAuthoringService,
} from '@/server/services/skillRegistry/createSkillAuthoringRuntimeService';
import type { ProjectSkillValidationResult } from '@/server/services/skillRegistry/ProjectSkillService';

import type { ServerRuntimeRegistration } from './types';

class DeviceProjectSkillAuthoringService implements ProjectSkillAuthoringService {
  constructor(
    private readonly options: {
      deviceId: string;
      scope: string;
      userId: string;
    },
  ) {}

  create(input: { content: string; name: string }) {
    return this.call('createProjectSkill', input);
  }

  async delete(name: string): Promise<void> {
    await this.call('deleteProjectSkill', { name });
  }

  async pack(name: string): Promise<Uint8Array> {
    const result = await this.call<{ archiveBase64: string }>('packProjectSkill', { name });
    return Uint8Array.from(Buffer.from(result.archiveBase64, 'base64'));
  }

  async promoteToUser<TResult>(
    name: string,
    adapter: {
      importProjectSkill: (input: {
        archive: Uint8Array;
        manifest: { description: string; name: string };
      }) => Promise<TResult>;
    },
  ): Promise<TResult> {
    const validation = await this.validate(name);
    if (!validation.valid || !validation.manifest) throw new Error(validation.errors.join(' '));
    return adapter.importProjectSkill({
      archive: await this.pack(name),
      manifest: validation.manifest,
    });
  }

  rename(name: string, newName: string) {
    return this.call('renameProjectSkill', { name, newName });
  }

  update(input: { content: string; name: string; path: string }) {
    return this.call('updateProjectSkill', input);
  }

  validate(name: string): Promise<ProjectSkillValidationResult> {
    return this.call('validateProjectSkill', { name });
  }

  private call<TResult = unknown>(
    method:
      | 'createProjectSkill'
      | 'deleteProjectSkill'
      | 'packProjectSkill'
      | 'renameProjectSkill'
      | 'updateProjectSkill'
      | 'validateProjectSkill',
    input: Record<string, unknown>,
  ): Promise<TResult> {
    return deviceGateway.executeProjectSkillRpc<TResult>({
      deviceId: this.options.deviceId,
      input: { ...input, scope: this.options.scope },
      method,
      userId: this.options.userId,
    });
  }
}

class UnavailableProjectSkillAuthoringService implements ProjectSkillAuthoringService {
  private unavailable(): never {
    throw new Error(
      'WORKSPACE_REQUIRED: project skill authoring requires a routed device workspace.',
    );
  }

  async create(): Promise<never> {
    return this.unavailable();
  }
  async delete(): Promise<void> {
    return this.unavailable();
  }
  async pack(): Promise<Uint8Array> {
    return this.unavailable();
  }
  async promoteToUser<TResult>(): Promise<TResult> {
    return this.unavailable();
  }
  async rename(): Promise<never> {
    return this.unavailable();
  }
  async update(): Promise<never> {
    return this.unavailable();
  }
  async validate(): Promise<ProjectSkillValidationResult> {
    return this.unavailable();
  }
}

export const skillAuthoringRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.serverDB) throw new Error('serverDB is required for skill authoring');
    if (!context.userId) throw new Error('userId is required for skill authoring');

    const frozen = context.executionContext;
    const scope = frozen?.workspace?.rootPath ?? frozen?.cwd;
    const projectSkills: ProjectSkillAuthoringService =
      frozen?.plan.kind === 'device' && scope
        ? new DeviceProjectSkillAuthoringService({
            deviceId: frozen.plan.deviceId,
            scope,
            userId: context.userId,
          })
        : new UnavailableProjectSkillAuthoringService();
    const importer = new SkillImporter(context.serverDB, context.userId, context.workspaceId);
    const service = createSkillAuthoringRuntimeService(projectSkills, {
      importProjectSkill: ({ archive }) => importer.importFromZipBuffer(archive),
    });
    const publishing = new SkillPublishingService(
      context.serverDB,
      context.userId,
      context.workspaceId,
    );
    return new SkillAuthoringExecutionRuntime({
      ...service,
      submitSkill: async ({ skillId, name }) => {
        if (!!skillId === !!name)
          throw new Error('Specify exactly one personal skillId or project skill name.');
        if (skillId) return publishing.submitPersonal(skillId);
        const archive = await projectSkills.pack(name!);
        return publishing.submitArchive(
          Buffer.from(archive),
          `project:${frozen?.plan.kind === 'device' ? frozen.plan.deviceId : ''}:${scope}:${name}`,
        );
      },
    });
  },
  identifier: SkillAuthoringIdentifier,
};
