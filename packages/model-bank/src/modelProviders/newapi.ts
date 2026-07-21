import { DEFAULT_MODEL } from '@lobechat/business-const';

import type { ModelProviderCard } from '@/types/llm';

const Aihub: ModelProviderCard = {
  chatModels: [],
  checkModel: DEFAULT_MODEL,
  description: 'Company-managed Aihub model access for Masterion.',
  enabled: true,
  id: 'newapi',
  name: 'Aihub',
  settings: {
    proxyUrl: {
      placeholder: process.env.AIHUB_PROXY_URL || 'https://aihub.bielcrystal.com',
    },
    showApiKey: false,
    sdkType: 'router',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://aihub.bielcrystal.com',
};

export default Aihub;
