import { COMPOSIO_APP_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';

import { isProductFeatureEnabled } from '@/config/productFeatures';

const externalAppIds = new Set([
  // The curated MCP catalog uses a separate identifier for GitHub.
  'github-official-mcp',
  ...COMPOSIO_APP_TYPES.map((app) => app.identifier),
  ...LOBEHUB_SKILL_PROVIDERS.map((provider) => provider.id),
]);

/** Presentation policy only; saved connections and runtime manifests remain intact. */
export const isIntegrationVisible = (identifier: string): boolean => {
  if (
    [
      'lobe-message',
      'discord',
      'telegram',
      'slack',
      'qq',
      'wechat',
      'feishu',
      'lark',
      'line',
      'imessage',
      'whatsapp',
    ].includes(identifier)
  )
    return isProductFeatureEnabled('externalMessaging');
  if (externalAppIds.has(identifier)) return isProductFeatureEnabled('externalApps');
  return true;
};
