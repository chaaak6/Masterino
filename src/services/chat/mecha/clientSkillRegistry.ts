import {
  CredsIdentifier,
  type CredSummary,
  injectCredsContext,
  type UserCredsContext,
} from '@lobechat/builtin-tool-creds';
import { SkillRegistry, type SkillRegistryResult } from '@lobechat/context-engine';
import { resourcesTreePrompt } from '@lobechat/prompts';
import type { SkillItem, UserCredSummary } from '@lobechat/types';
import type {
  ProjectWorkspaceSkillPolicy,
  SkillProvider,
  SkillProviderContext,
  SkillRef,
} from '@lobechat/types/src/projectWorkspace';
import debug from 'debug';

import { agentSkillService } from '@/services/skill';
import { getToolStoreState } from '@/store/tool';

const log = debug('context-engine:client-skill-registry');

const buildDbSkillContent = (detail: SkillItem, skillKey: string): string | undefined => {
  if (!detail.content) return undefined;
  if (!detail.resources || Object.keys(detail.resources).length === 0) return detail.content;
  return detail.content + '\n\n' + resourcesTreePrompt(skillKey, detail.resources);
};

const buildCredsContext = (userCreds?: UserCredSummary[]): UserCredsContext => ({
  creds: (userCreds || []).map<CredSummary>((cred) => ({
    description: cred.description,
    key: cred.key,
    name: cred.name,
    type: cred.type,
  })),
  settingsUrl: '/settings/creds',
});

export interface ResolveClientSkillRegistryOptions {
  /** Accepted operation-scoped agent provider; callers must not synthesize its refs here. */
  agentProvider?: SkillProvider & { source: 'agent' };
  contentIdentifiers?: string[];
  policy?: ProjectWorkspaceSkillPolicy;
  /** Accepted workspace/skill context produced by the operation runtime. */
  skillContext?: SkillProviderContext;
  userCreds?: UserCredSummary[];
}

/** Client projection of the shared registry used by both prompt assembly and selected skills. */
export const resolveClientSkillRegistry = async (
  options: ResolveClientSkillRegistryOptions = {},
): Promise<SkillRegistryResult> => {
  const toolState = getToolStoreState();
  const requested = new Set(options.contentIdentifiers ?? []);

  const builtinProvider: SkillProvider = {
    list: async () =>
      (toolState.builtinSkills || []).map<SkillRef>((skill) => ({
        content:
          skill.identifier === CredsIdentifier
            ? injectCredsContext(skill.content, buildCredsContext(options.userCreds))
            : skill.content,
        description: skill.description,
        identifier: skill.identifier,
        key: `builtin:${skill.identifier}`,
        name: skill.name,
        scope: 'builtin',
        source: 'builtin',
      })),
    source: 'builtin',
  };

  const userProvider: SkillProvider = {
    list: async (context) => {
      const listItems = [...(toolState.agentSkills || [])];
      const knownIds = new Set(listItems.map(({ identifier }) => identifier));

      const extraDetails = await Promise.all(
        [...requested]
          .filter((identifier) => !knownIds.has(identifier))
          .map(async (identifier) => {
            try {
              return await agentSkillService.getByIdentifier(identifier);
            } catch (error) {
              log('Failed to resolve selected skill %s: %O', identifier, error);
              return undefined;
            }
          }),
      );

      const refs: SkillRef[] = [];
      for (const item of listItems) {
        const key = `user:${item.identifier}`;
        let content: string | undefined;
        if (requested.has(item.identifier) && !item.zipFileHash) {
          try {
            const detail =
              toolState.agentSkillDetailMap?.[item.id] ??
              (await agentSkillService.getById(item.id));
            if (detail) content = buildDbSkillContent(detail, key);
          } catch (error) {
            log('Failed to load selected skill content %s: %O', item.identifier, error);
          }
        }

        refs.push({
          content,
          description: item.description ?? '',
          identifier: item.identifier,
          key,
          name: item.name,
          ownerId: context.userId,
          scope: 'personal',
          source: 'user',
          zipFileHash: item.zipFileHash,
        });
      }

      for (const detail of extraDetails) {
        if (!detail) continue;
        const key = `user:${detail.identifier}`;
        refs.push({
          content: detail.zipFileHash ? undefined : buildDbSkillContent(detail, key),
          description: detail.description ?? '',
          identifier: detail.identifier,
          key,
          name: detail.name,
          ownerId: context.userId,
          scope: 'personal',
          source: 'user',
          zipFileHash: detail.zipFileHash,
        });
      }

      return refs;
    },
    source: 'user',
  };

  const projectProvider: SkillProvider = {
    list: async (context) => {
      if (!context.workspace) return [];
      const ownerId = context.workspace.id ?? context.userId;

      return (context.workspaceInit?.skills ?? []).map<SkillRef>((skill) => ({
        description: skill.description ?? '',
        identifier: `project:${skill.name}`,
        key: `project:${ownerId}:${skill.name}`,
        location: skill.path,
        name: skill.name,
        ownerId,
        scope: 'project',
        source: 'project',
      }));
    },
    source: 'project',
  };

  const registry = new SkillRegistry({
    providers: [
      builtinProvider,
      userProvider,
      ...(options.agentProvider ? [options.agentProvider] : []),
      projectProvider,
    ],
  });
  const policy = {
    includeAgentSkills: true,
    includeProjectSkills: true,
    includeUserSkills: true,
    ...options.skillContext?.skillPolicy,
    ...options.policy,
  };
  const context: SkillProviderContext = {
    agentId: options.skillContext?.agentId ?? 'client-agent',
    skillPolicy: policy,
    userId: options.skillContext?.userId ?? 'client-user',
    workspace: options.skillContext?.workspace,
    workspaceInit: options.skillContext?.workspaceInit,
  };

  return registry.resolve(context, {
    userId: context.userId,
    workspaceId: context.workspace?.id,
  });
};
