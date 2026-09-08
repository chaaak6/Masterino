import type { ExecScriptActivatedSkill } from '@lobechat/builtin-tool-skills';

import { agentSkillService } from '@/services/skill';

import { localFileService } from './localFileService';

class DesktopSkillRuntimeService {
  private async prepareSkillDirectoryForSkill(skill?: {
    id: string;
    name: string;
    zipFileHash?: string | null;
  }) {
    if (!skill?.zipFileHash) return undefined;

    const zipUrl = await agentSkillService.getZipUrl(skill.id);
    if (!zipUrl.url) return undefined;

    const prepared = await localFileService.prepareSkillDirectory({
      url: zipUrl.url,
      zipHash: skill.zipFileHash,
    });

    if (!prepared.success) {
      throw new Error(prepared.error || `Failed to prepare local skill directory: ${skill.name}`);
    }

    return prepared.extractedDir;
  }

  private async resolveSkill(params: { id?: string; name?: string }) {
    // Execution callers translate the operation key to this exact database ID.
    // Never replace a missing ID with a same-name skill from another source.
    return params.id ? agentSkillService.getById(params.id) : undefined;
  }

  async resolveExecutionDirectory(
    activatedSkills?: ExecScriptActivatedSkill[],
  ): Promise<string | undefined> {
    for (const activated of [...(activatedSkills ?? [])].reverse()) {
      const skill = await this.resolveSkill({ id: activated.id, name: activated.name });
      if (skill?.zipFileHash && activated.resourceVersion !== skill.zipFileHash)
        throw new Error('SKILL_RESOURCE_VERSION_CHANGED: activate this skill again');
      const directory = await this.prepareSkillDirectoryForSkill(skill);
      if (directory) return directory;
    }
    return undefined;
  }

  async resolveReferenceFullPath(params: {
    path: string;
    skillId?: string;
    skillName?: string;
  }): Promise<string | undefined> {
    const skill = await this.resolveSkill({ id: params.skillId, name: params.skillName });
    if (!skill?.zipFileHash) return undefined;

    const zipUrl = await agentSkillService.getZipUrl(skill.id);
    if (!zipUrl.url) return undefined;

    const resolved = await localFileService.resolveSkillResourcePath({
      path: params.path,
      url: zipUrl.url,
      zipHash: skill.zipFileHash,
    });

    if (!resolved.success) {
      throw new Error(
        resolved.error || `Failed to resolve skill resource path: ${skill.name}/${params.path}`,
      );
    }

    return resolved.fullPath;
  }
}

export const desktopSkillRuntimeService = new DesktopSkillRuntimeService();
