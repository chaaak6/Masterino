import { isDesktop } from '@lobechat/const';
import type { ExecutionContext } from '@lobechat/types/src/executionContext';

import { shouldEnableBuiltinSkill } from './skillFilters';
import { shouldEnableTool } from './toolFilters';

export interface ToolAvailabilityInstalledPlugin {
  customParams?: {
    mcp?: {
      type?: string;
    } | null;
  } | null;
  identifier: string;
}

export interface ToolAvailabilityContext {
  executionContext?: ExecutionContext;
  installedPlugins?: ToolAvailabilityInstalledPlugin[];
  isDesktop?: boolean;
}

export const isBuiltinToolAvailableInCurrentEnv = (id: string) => shouldEnableTool(id);

export const isBuiltinSkillAvailableInCurrentEnv = (
  id: string,
  context: Omit<ToolAvailabilityContext, 'installedPlugins'> = {},
) => {
  if (context.isDesktop === undefined) {
    return shouldEnableBuiltinSkill(id);
  }

  return shouldEnableBuiltinSkill(id, {
    isDesktop: context.isDesktop ?? isDesktop,
  });
};

export const isInstalledPluginAvailableInCurrentEnv = (
  plugin: ToolAvailabilityInstalledPlugin,
  context: Omit<ToolAvailabilityContext, 'installedPlugins'> = {},
) => (context.isDesktop ?? isDesktop) || plugin.customParams?.mcp?.type !== 'stdio';

export const isToolAvailableInCurrentEnv = (id: string, context: ToolAvailabilityContext = {}) => {
  const execution = context.executionContext;
  if (execution) {
    if (id === 'lobe-cloud-sandbox' && execution.plan.kind !== 'sandbox') return false;
    if (
      (id === 'lobe-local-system' || id === 'lobe-skill-authoring') &&
      execution.plan.kind !== 'device'
    )
      return false;
    context = {
      ...context,
      isDesktop: execution.plan.kind === 'device' && execution.plan.target === 'local',
    };
  }
  if (!isBuiltinToolAvailableInCurrentEnv(id)) return false;
  if (!isBuiltinSkillAvailableInCurrentEnv(id, context)) return false;

  const plugin = context.installedPlugins?.find((item) => item.identifier === id);

  if (!plugin) return true;

  return isInstalledPluginAvailableInCurrentEnv(plugin, context);
};

export const filterToolIdsByCurrentEnv = (ids: string[], context: ToolAvailabilityContext = {}) =>
  ids.filter((id) => isToolAvailableInCurrentEnv(id, context));
