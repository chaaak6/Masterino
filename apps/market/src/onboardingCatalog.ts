export type OnboardingCategory =
  | 'business-strategy'
  | 'content-creation'
  | 'engineering'
  | 'learning-research'
  | 'operations'
  | 'product-management';

export interface OnboardingAgentCatalogEntry {
  avatar: string;
  category: OnboardingCategory;
  identifier: string;
  seedVersion: string;
}

/** Product-owned, deliberately small and ordered onboarding catalog. */
export const ONBOARDING_AGENT_CATALOG: readonly OnboardingAgentCatalogEntry[] = [
  {
    avatar: '/assets/agent-avatars/v1/meeting.svg',
    category: 'operations',
    identifier: 'masterino-meeting-assistant',
    seedVersion: '2.1.0',
  },
  {
    avatar: '/assets/agent-avatars/v1/writing.svg',
    category: 'content-creation',
    identifier: 'curated-lobehub-writing-assistant',
    seedVersion: '1.1.0',
  },
  {
    avatar: '/assets/agent-avatars/v1/translation.svg',
    category: 'content-creation',
    identifier: 'curated-lobehub-en-cn-translator',
    seedVersion: '1.1.0',
  },
  {
    avatar: '/assets/agent-avatars/v1/research.svg',
    category: 'learning-research',
    identifier: 'masterino-research-assistant',
    seedVersion: '2.1.0',
  },
  {
    avatar: '/assets/agent-avatars/v1/project.svg',
    category: 'product-management',
    identifier: 'curated-lobehub-mu6pt9gg',
    seedVersion: '1.1.0',
  },
  {
    avatar: '/assets/agent-avatars/v1/code.svg',
    category: 'engineering',
    identifier: 'curated-lobehub-7xjj75u8',
    seedVersion: '1.1.0',
  },
  {
    avatar: '/assets/agent-avatars/v1/prompt.svg',
    category: 'learning-research',
    identifier: 'curated-lobehub-34z99to7',
    seedVersion: '1.1.0',
  },
  {
    avatar: '/assets/agent-avatars/v1/business.svg',
    category: 'business-strategy',
    identifier: 'curated-lobehub-business-guru',
    seedVersion: '1.1.0',
  },
] as const;

export const ONBOARDING_AGENT_IDENTIFIERS = ONBOARDING_AGENT_CATALOG.map(
  ({ identifier }) => identifier,
);

const onboardingAgentByIdentifier = new Map(
  ONBOARDING_AGENT_CATALOG.map((entry) => [entry.identifier, entry]),
);

export const getOnboardingAgentCatalogEntry = (identifier: string) =>
  onboardingAgentByIdentifier.get(identifier);

export const applyOnboardingSeedMetadata = <T extends Record<string, any>>(resource: T): T => {
  const entry = getOnboardingAgentCatalogEntry(resource.identifier);
  if (!entry) return resource;

  return {
    ...resource,
    avatar: entry.avatar,
    category: entry.category,
    version: entry.seedVersion,
  };
};

export const resolveMarketAvatar = (avatar: unknown, publicBaseUrl: string): unknown => {
  if (typeof avatar !== 'string' || !avatar.startsWith('/assets/agent-avatars/')) return avatar;

  return new URL(avatar.slice(1), `${publicBaseUrl.replace(/\/$/, '')}/`).toString();
};
