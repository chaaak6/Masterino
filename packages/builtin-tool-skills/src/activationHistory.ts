import type { ExecScriptActivatedSkill } from './types';
import { SkillsIdentifier } from './types';

interface ActivationMessage {
  error?: unknown;
  plugin?: { apiName?: string; identifier?: string } | null;
  pluginState?: unknown;
  role: string;
}

/** Use persisted successful activations, ordered by their latest occurrence. */
export function selectActivatedSkillsFromMessages(
  messages: ActivationMessage[],
): ExecScriptActivatedSkill[] | undefined {
  const skills = new Map<string, ExecScriptActivatedSkill>();
  const add = (value: unknown) => {
    if (!value || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string')
      return;
    const id = 'id' in value && typeof value.id === 'string' ? value.id : undefined;
    if (!id) return;
    skills.delete(id);
    skills.set(id, {
      id,
      ...('resourceVersion' in value && typeof value.resourceVersion === 'string'
        ? { resourceVersion: value.resourceVersion }
        : {}),
      name: value.name,
      description:
        'description' in value && typeof value.description === 'string'
          ? value.description
          : undefined,
    });
  };
  for (const message of messages) {
    if (
      message.role !== 'tool' ||
      message.error ||
      ![SkillsIdentifier, 'lobe-activator'].includes(message.plugin?.identifier ?? '')
    )
      continue;
    if (message.plugin?.apiName === 'activateSkill') add(message.pluginState);
    if (
      message.plugin?.apiName === 'activateTools' &&
      message.pluginState &&
      typeof message.pluginState === 'object' &&
      'activatedSkills' in message.pluginState &&
      Array.isArray(message.pluginState.activatedSkills)
    ) {
      for (const skill of message.pluginState.activatedSkills) add(skill);
    }
  }
  return skills.size ? [...skills.values()] : undefined;
}
