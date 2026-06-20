import type { ModelProviderCard } from '@/types/llm';

const DEFAULT_AIHUB_MODEL = process.env.AIHUB_DEFAULT_MODEL || 'glm-5.1';

const Aihub: ModelProviderCard = {
  chatModels: [],
  checkModel: DEFAULT_AIHUB_MODEL,
  description: 'Company-managed Aihub model access for MasterLion.',
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
