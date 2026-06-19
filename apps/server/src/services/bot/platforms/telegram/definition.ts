import type { PlatformDefinition } from '../types';
import { TelegramClientFactory } from './client';
import { schema } from './schema';

export const telegram: PlatformDefinition = {
  id: 'telegram',
  name: 'Telegram',
  connectionMode: 'webhook',
  description: 'Connect a Telegram bot',
  documentation: {
    portalUrl: 'https://t.me/BotFather',
    setupGuideUrl: 'https://aihub.bielcrystal.com',
  },
  schema,
  clientFactory: new TelegramClientFactory(),
};
