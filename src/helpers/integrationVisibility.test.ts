import { COMPOSIO_APP_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import type { ServerConfigStore } from '@/store/serverConfig/store';
import { initialState } from '@/store/tool/initialState';
import { builtinToolSelectors } from '@/store/tool/slices/builtin/selectors';

import { isIntegrationVisible } from './integrationVisibility';

describe('company integration visibility', () => {
  it('Given server integrations are enabled, When rendering app entry points, Then both catalogs stay hidden', () => {
    const state = {
      serverConfig: { enableComposio: true, enableLobehubSkill: true },
    } as ServerConfigStore;
    expect(serverConfigSelectors.enableComposio(state)).toBe(false);
    expect(serverConfigSelectors.enableLobehubSkill(state)).toBe(false);
    expect(isIntegrationVisible('github-official-mcp')).toBe(false);
    for (const id of [
      'qq',
      'wechat',
      'telegram',
      'discord',
      'feishu',
      'lark',
      'line',
      'imessage',
      'whatsapp',
    ])
      expect(isIntegrationVisible(id)).toBe(false);
    for (const id of [
      ...COMPOSIO_APP_TYPES.map((app) => app.identifier),
      ...LOBEHUB_SKILL_PROVIDERS.map((provider) => provider.id),
    ]) {
      expect(isIntegrationVisible(id)).toBe(false);
    }
  });

  it('Given installed messaging, When opening tool pickers, Then it is hidden and internal interaction stays available', () => {
    const state = {
      ...initialState,
      builtinSkills: [],
      agentSkills: [],
      builtinTools: ['lobe-message', 'lobe-user-interaction', 'lobe-task'].map((identifier) => ({
        identifier,
        manifest: { identifier, meta: { title: identifier }, api: [], systemRole: '' },
        type: 'builtin' as const,
      })),
    };
    for (const selector of [
      builtinToolSelectors.metaList,
      builtinToolSelectors.metaListIncludingHidden,
      builtinToolSelectors.allMetaList,
      builtinToolSelectors.installedAllMetaList,
      builtinToolSelectors.discoverableMetaList,
    ]) {
      expect(selector(state).map((tool) => tool.identifier)).toEqual([
        'lobe-user-interaction',
        'lobe-task',
      ]);
    }
    expect(state.builtinTools.map((tool) => tool.identifier)).toContain('lobe-message');
  });

  it('Given local and company tools, When applying visibility, Then they are preserved', () => {
    for (const id of [
      'lobe-web-browsing',
      'lobe-user-interaction',
      'lobe-local-system',
      'company-internal-mcp',
    ]) {
      expect(isIntegrationVisible(id)).toBe(true);
    }
  });
});
