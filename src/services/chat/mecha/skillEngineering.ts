import type { OperationSkillSet } from '@lobechat/context-engine';
import { SkillEngine } from '@lobechat/context-engine';

import { isBuiltinSkillAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { agentDocumentService } from '@/services/agentDocument';

import {
  resolveClientSkillRegistry,
  type ResolveClientSkillRegistryOptions,
} from './clientSkillRegistry';

export type ResolveClientSkillsOptions = Omit<
  ResolveClientSkillRegistryOptions,
  'contentIdentifiers'
>;

/**
 * Build a client-side OperationSkillSet via SkillEngine.
 *
 * Sources:
 * 1. Builtin skills (e.g., Artifacts) - from toolStore.builtinSkills
 * 2. DB skills (user/market) - from toolStore.agentSkills
 *
 * Pinned skills (ids in `pluginIds`) carry their full `content` so the
 * SkillContextProvider can inject it directly into the system prompt instead of
 * only listing them under `<available_skills>`. Builtin content is already in
 * memory; DB content is fetched on demand (store cache first) and only for the
 * pinned skills, to avoid bulk network calls when auto mode exposes every skill.
 *
 * Uses isBuiltinSkillAvailableInCurrentEnv as the enableChecker to
 * filter platform-specific skills (e.g., agent-browser on desktop only).
 */
export const resolveClientSkills = async (
  pluginIds?: string[],
  options: ResolveClientSkillsOptions = {},
): Promise<OperationSkillSet> => {
  const pinnedIds = new Set(pluginIds ?? []);
  const registry = await resolveClientSkillRegistry({
    ...options,
    agentProvider:
      options.agentProvider ??
      (options.skillContext?.agentId
        ? {
            source: 'agent',
            list: async (context) =>
              (await agentDocumentService.getSkills({ agentId: context.agentId })).map((skill) => ({
                ...skill,
                key: `agent:${skill.identifier}`,
                ownerId: context.agentId,
                scope: 'personal',
                source: 'agent',
              })),
          }
        : undefined),
    contentIdentifiers: pluginIds,
    policy: { ...options.policy, pinned: pluginIds },
  });

  const skillEngine = new SkillEngine({
    enableChecker: (skill) => isBuiltinSkillAvailableInCurrentEnv(skill.identifier),
    registry,
    skills: registry.skills.map((skill) => ({
      activated: pinnedIds.has(skill.identifier) && !!skill.content,
      content: skill.content,
      description: skill.description,
      identifier: skill.identifier,
      key: skill.key,
      location: skill.location,
      name: skill.name,
      scope: skill.scope,
      source: skill.source,
    })),
  });

  return skillEngine.generate(pluginIds ?? []);
};
