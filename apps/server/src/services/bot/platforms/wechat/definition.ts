import type { PlatformDefinition } from '../types';
import { WechatClientFactory } from './client';
import { schema } from './schema';

export const wechat: PlatformDefinition = {
  id: 'wechat',
  name: 'WeChat',
  connectionMode: 'polling',
  description: 'Connect a WeChat bot via iLink API',
  documentation: {
    setupGuideUrl: 'https://aihub.bielcrystal.com',
  },
  schema,
  supportsMessageEdit: false,
  clientFactory: new WechatClientFactory(),
};
