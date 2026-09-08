/**
 * Lobe Tools Executor
 *
 * Creates and exports the ActivatorExecutor instance for registration.
 * Resolves tool manifests from the tool store (installedPlugins + builtinTools +
 * lobehubSkillServers + composio servers).
 *
 * State tracking (getActivatedToolIds / markActivated) is intentionally a no-op
 * because the activated state is persisted in message pluginState and accumulated
 * by selectActivatedToolIdsFromMessages at each agentic loop step.
 */
import {
  ActivatorExecutionRuntime,
  type ActivatorRuntimeService,
  type ToolManifestInfo,
} from '@lobechat/builtin-tool-activator/executionRuntime';
import { ActivatorExecutor } from '@lobechat/builtin-tool-activator/executor';
import type { BuiltinToolContext } from '@lobechat/types';

import { getToolStoreState } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors/tool';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore';

const createService = (ctx: BuiltinToolContext): ActivatorRuntimeService => ({
  getActivatedToolIds: () => [],
  getToolManifests: async (identifiers: string[]): Promise<ToolManifestInfo[]> => {
    const s = getToolStoreState();

    // Only allow activation of tools that passed discovery filters
    // (discoverable, platform-available, not internal/hidden)
    const discoverable = new Set(
      toolSelectors
        .availableToolsForDiscovery(s, { executionContext: ctx.executionContext })
        .map((t) => t.identifier),
    );
    const allowedIds = identifiers.filter((id) => discoverable.has(id));

    const results: ToolManifestInfo[] = [];

    for (const id of allowedIds) {
      // Search builtin tools
      const builtin = s.builtinTools.find((t) => t.identifier === id);
      if (builtin) {
        results.push({
          apiDescriptions: builtin.manifest.api.map((a) => ({
            description: a.description,
            name: a.name,
          })),
          avatar: builtin.manifest.meta?.avatar,
          identifier: builtin.identifier,
          name: builtin.manifest.meta?.title ?? builtin.identifier,
          systemRole: builtin.manifest.systemRole,
        });
        continue;
      }

      // Search installed plugins
      const plugin = s.installedPlugins.find((p) => p.identifier === id);
      if (plugin?.manifest) {
        results.push({
          apiDescriptions: (plugin.manifest.api || []).map((a) => ({
            description: a.description,
            name: a.name,
          })),
          avatar: plugin.manifest.meta?.avatar,
          identifier: plugin.identifier,
          name: plugin.manifest.meta?.title ?? plugin.identifier,
          systemRole: plugin.manifest.systemRole,
        });
        continue;
      }

      // Search LobeHub Skill servers
      const lobehubSkillServer = s.lobehubSkillServers?.find(
        (server) => server.identifier === id && server.status === LobehubSkillStatus.CONNECTED,
      );
      if (lobehubSkillServer?.tools) {
        results.push({
          apiDescriptions: lobehubSkillServer.tools.map((t) => ({
            description: t.description || '',
            name: t.name,
          })),
          avatar: lobehubSkillServer.icon,
          identifier: lobehubSkillServer.identifier,
          name: lobehubSkillServer.name,
        });
        continue;
      }
    }

    return results;
  },
  markActivated: () => {},
});

export const activatorExecutor = new ActivatorExecutor(
  (ctx) => new ActivatorExecutionRuntime({ service: createService(ctx) }),
);
