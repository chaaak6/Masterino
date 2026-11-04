import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  CreateProjectSkillArgs,
  ProjectSkillTargetArgs,
  RenameProjectSkillArgs,
  UpdateProjectSkillArgs,
} from '../types';

export interface SkillAuthoringValidation {
  errors: string[];
  files: string[];
  manifest?: { description: string; name: string };
  totalBytes: number;
  valid: boolean;
}

/** Server adapter implemented by ProjectSkillService plus the personal-skill importer. */
export interface SkillAuthoringRuntimeService {
  create: (input: CreateProjectSkillArgs) => Promise<unknown>;
  delete: (name: string) => Promise<void>;
  pack: (name: string) => Promise<Uint8Array>;
  promoteToUser: (name: string) => Promise<unknown>;
  rename: (name: string, newName: string) => Promise<unknown>;
  submitSkill?: (input: { skillId?: string; name?: string }) => Promise<unknown>;
  update: (input: UpdateProjectSkillArgs) => Promise<unknown>;
  validate: (name: string) => Promise<SkillAuthoringValidation>;
}

export class SkillAuthoringExecutionRuntime {
  constructor(private readonly service: SkillAuthoringRuntimeService) {}

  async submitSkill(args: {
    skillId?: string;
    name?: string;
  }): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.service.submitSkill) throw new Error('Skill submission is unavailable.');
      const submission = await this.service.submitSkill(args);
      return { success: true, content: JSON.stringify(submission), state: { submission } };
    } catch (error) {
      return this.failure('submit', error);
    }
  }

  createProjectSkill(args: CreateProjectSkillArgs): Promise<BuiltinServerRuntimeOutput> {
    return this.mutateAndValidate('Created', args.name, () => this.service.create(args));
  }

  updateProjectSkill(args: UpdateProjectSkillArgs): Promise<BuiltinServerRuntimeOutput> {
    return this.mutateAndValidate('Updated', args.name, () => this.service.update(args));
  }

  renameProjectSkill(args: RenameProjectSkillArgs): Promise<BuiltinServerRuntimeOutput> {
    return this.mutateAndValidate('Renamed', args.newName, () =>
      this.service.rename(args.name, args.newName),
    );
  }

  async deleteProjectSkill(args: ProjectSkillTargetArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      await this.service.delete(args.name);
      return { content: `Deleted project skill "${args.name}".`, success: true };
    } catch (error) {
      return this.failure('delete', error);
    }
  }

  async validateProjectSkill(args: ProjectSkillTargetArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      const validation = await this.service.validate(args.name);
      return {
        content: validation.valid
          ? `Project skill "${args.name}" is valid.`
          : `Project skill "${args.name}" is invalid: ${validation.errors.join(' ')}`,
        state: { validation },
        success: validation.valid,
      };
    } catch (error) {
      return this.failure('validate', error);
    }
  }

  async packProjectSkill(args: ProjectSkillTargetArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      const validation = await this.service.validate(args.name);
      if (!validation.valid) return this.invalid(args.name, validation);
      const archive = await this.service.pack(args.name);
      return {
        content: `Packed project skill "${args.name}" (${archive.byteLength} bytes).`,
        state: { archive, size: archive.byteLength, validation },
        success: true,
      };
    } catch (error) {
      return this.failure('pack', error);
    }
  }

  async promoteProjectSkill(args: ProjectSkillTargetArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      const validation = await this.service.validate(args.name);
      if (!validation.valid) return this.invalid(args.name, validation);
      const promoted = await this.service.promoteToUser(args.name);
      return {
        content: `Promoted project skill "${args.name}" to the personal skill library.`,
        state: { promoted, validation },
        success: true,
      };
    } catch (error) {
      return this.failure('promote', error);
    }
  }

  private async mutateAndValidate(
    verb: string,
    name: string,
    mutate: () => Promise<unknown>,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      await mutate();
      const validation = await this.service.validate(name);
      if (!validation.valid) return this.invalid(name, validation);
      return {
        content: `${verb} project skill "${name}" and validated it successfully.`,
        state: { validation },
        success: true,
      };
    } catch (error) {
      return this.failure(verb.toLowerCase(), error);
    }
  }

  private invalid(name: string, validation: SkillAuthoringValidation): BuiltinServerRuntimeOutput {
    return {
      content: `Project skill "${name}" is invalid: ${validation.errors.join(' ')}`,
      state: { validation },
      success: false,
    };
  }

  private failure(action: string, error: unknown): BuiltinServerRuntimeOutput {
    return {
      content: `Failed to ${action} project skill: ${
        error instanceof Error ? error.message : String(error)
      }`,
      success: false,
    };
  }
}
