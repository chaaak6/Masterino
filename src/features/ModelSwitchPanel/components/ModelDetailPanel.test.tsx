/**
 * @vitest-environment happy-dom
 */
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import ModelDetailPanel from './ModelDetailPanel';

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    actionText: 'actionText',
    container: 'container',
    originalPriceText: 'originalPriceText',
    priceValue: 'priceValue',
    row: 'row',
    titleText: 'titleText',
  }),
  cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }),
  cx: (...classNames: unknown[]) => classNames.filter(Boolean).join(' '),
  useResponsive: () => ({ mobile: false }),
}));

vi.mock('@lobehub/ui', () => ({
  Accordion: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AccordionItem: ({
    action,
    children,
    title,
  }: {
    action?: ReactNode;
    children?: ReactNode;
    title?: ReactNode;
  }) => (
    <section>
      <div>{title}</div>
      <div>{action}</div>
      <div>{children}</div>
    </section>
  ),
  Avatar: () => <span />,
  Flexbox: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  Icon: () => <span />,
  Tag: ({ children, ...props }: { children: ReactNode }) => <span {...props}>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children, title }: { children: ReactNode; title?: ReactNode }) => (
    <span>
      {title}
      {children}
    </span>
  ),
  TooltipGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tooltip: ({ children, title }: { children: ReactNode; title?: ReactNode }) => (
    <span>
      {title}
      {children}
    </span>
  ),
}));

vi.mock('@lobehub/icons', () => ({
  LobeHub: { Morden: () => <span /> },
  ModelIcon: () => <span />,
  ProviderIcon: () => <span />,
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (state: { enabledAiModels: never[] }) => unknown) =>
    selector({ enabledAiModels: [] }),
}));

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: () => [],
}));

const globalState = {
  status: {
    modelDetailPanelExpandedKeys: ['pricing'],
  },
  updateModelDetailPanelExpandedKeys: vi.fn(),
};

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: typeof globalState) => unknown) => selector(globalState),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    modelDetailPanelExpandedKeys: (state: typeof globalState) =>
      state.status.modelDetailPanelExpandedKeys,
  },
}));

const translations: Record<string, string> = {
  'ModelSwitchPanel.detail.context': 'Context Length',
  'ModelSwitchPanel.detail.pricing': 'Pricing',
  'ModelSwitchPanel.detail.pricing.credits.input': 'Input {{amount}} credits/M tokens',
  'ModelSwitchPanel.detail.pricing.credits.output': 'Output {{amount}} credits/M tokens',
  'ModelSwitchPanel.detail.pricing.credits.perImage': '~ {{amount}} credits / image',
  'ModelSwitchPanel.detail.pricing.credits.perVideo': '~ {{amount}} credits / video',
  'ModelSwitchPanel.detail.pricing.credits.image': 'credits/img',
  'ModelSwitchPanel.detail.pricing.credits.millionTokens': 'credits/M tokens',
  'ModelSwitchPanel.detail.pricing.group.image': 'Image',
  'ModelSwitchPanel.detail.pricing.group.text': 'Text',
  'ModelSwitchPanel.detail.pricing.input': 'Input ${{amount}}/M',
  'ModelSwitchPanel.detail.pricing.output': 'Output ${{amount}}/M',
  'ModelSwitchPanel.detail.pricing.perImage': '~ ${{amount}} / image',
  'ModelSwitchPanel.detail.pricing.perVideo': '~ ${{amount}} / video',
  'ModelSwitchPanel.detail.pricing.unit.imageGeneration': 'Image Generation',
  'ModelSwitchPanel.detail.pricing.unit.textInput': 'Input',
  'ModelSwitchPanel.detail.pricing.unit.textOutput': 'Output',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const template = translations[key] ?? options?.defaultValue ?? key;

      return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name) => options?.[name] ?? '');
    },
  }),
}));

const textPricing = {
  currency: 'USD',
  units: [
    { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
  ],
};

const imagePricing = {
  approximatePricePerImage: 0.04,
  approximatePricePerVideo: 0.8,
  currency: 'USD',
  units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
};

const createEnabledList = (
  provider: string,
  pricing: Record<string, unknown>,
  abilities: Record<string, boolean> = {},
): EnabledProviderWithModels[] => [
  {
    children: [
      {
        abilities,
        contextWindowTokens: 1_000_000,
        displayName: 'Test Model',
        id: 'test-model',
        pricing,
        type: 'chat',
      } as any,
    ],
    id: provider,
    name: provider,
    source: 'builtin',
  },
];

describe('ModelDetailPanel pricing', () => {
  it('shows an unavailable tariff instead of presenting catalog fallback prices as Aihub credits', () => {
    const { container } = render(
      <ModelDetailPanel
        enabledList={createEnabledList(BRANDING_PROVIDER, textPricing)}
        model="test-model"
        provider={BRANDING_PROVIDER}
      />,
    );
    expect(container).toHaveTextContent('ModelSwitchPanel.aihubPricing.unavailable');
    expect(container).not.toHaveTextContent('credits');
    expect(container).not.toHaveTextContent('5.00');
  });

  it('shows the persisted Aihub CNY tariff including a zero cache rate', () => {
    const enabledList = createEnabledList(BRANDING_PROVIDER, textPricing);
    enabledList[0].children[0].aihubPricing = {
      version: 1,
      source: 'aihub',
      currency: 'CNY',
      fetchedAt: new Date().toISOString(),
      scope: 'public',
      status: 'available',
      tiers: [],
      displayRates: {
        input: { min: 2, max: 2 },
        output: { min: 8, max: 8 },
        cacheRead: { min: 0, max: 0 },
      },
    };
    const { container } = render(
      <ModelDetailPanel
        enabledList={enabledList}
        model="test-model"
        provider={BRANDING_PROVIDER}
      />,
    );
    expect(container).toHaveTextContent('¥2');
    expect(container).toHaveTextContent('¥8');
    expect(container).toHaveTextContent('¥0');
    expect(container).not.toHaveTextContent('ModelSwitchPanel.aihubPricing.public');
    expect(container).not.toHaveTextContent('ModelSwitchPanel.aihubPricing.updated');
    expect(container).not.toHaveTextContent('credits');
  });

  it('shows at most two decimal places without displaying tiny positive prices as free', () => {
    const enabledList = createEnabledList(BRANDING_PROVIDER, textPricing);
    enabledList[0].children[0].aihubPricing = {
      version: 1,
      source: 'aihub',
      currency: 'CNY',
      fetchedAt: new Date().toISOString(),
      scope: 'public',
      status: 'available',
      tiers: [],
      displayRates: {
        input: { min: 8.999994, max: 8.999994 },
        output: { min: 0.0000001234, max: 0.0000001234 },
      },
    };
    const { container } = render(
      <ModelDetailPanel
        enabledList={enabledList}
        model="test-model"
        provider={BRANDING_PROVIDER}
      />,
    );
    expect(container).toHaveTextContent('¥9');
    expect(container).not.toHaveTextContent('8.999');
    expect(container).toHaveTextContent('< ¥0.01');
  });

  it('keeps dollar pricing for non-branding providers', () => {
    const { container } = render(
      <ModelDetailPanel
        enabledList={createEnabledList('openai', textPricing)}
        model="test-model"
        provider="openai"
      />,
    );

    expect(container).toHaveTextContent('$5.00/M tokens');
    expect(container).toHaveTextContent('$25.00/M tokens');
    expect(container).not.toHaveTextContent('credits/M tokens');
  });

  it('renders branding provider image and video pricing in credits', () => {
    const imageResult = render(
      <ModelDetailPanel
        enabledList={createEnabledList(BRANDING_PROVIDER, imagePricing)}
        model="test-model"
        pricingMode="image"
        provider={BRANDING_PROVIDER}
      />,
    );

    expect(imageResult.container).toHaveTextContent('~ 40.0K credits / image');
    expect(imageResult.container).toHaveTextContent('40.0K credits/img');
    expect(imageResult.container).not.toHaveTextContent('$0.04');

    imageResult.unmount();

    const videoResult = render(
      <ModelDetailPanel
        enabledList={createEnabledList(BRANDING_PROVIDER, imagePricing)}
        model="test-model"
        pricingMode="video"
        provider={BRANDING_PROVIDER}
      />,
    );

    expect(videoResult.container).toHaveTextContent('~ 800.0K credits / video');
    expect(videoResult.container).not.toHaveTextContent('$0.80');
  });
});

describe('ModelDetailPanel input modality', () => {
  it('shows separate image and video states without diagnostic text', () => {
    globalState.status.modelDetailPanelExpandedKeys = ['abilities'];

    const { container } = render(
      <ModelDetailPanel
        enabledList={createEnabledList('openai', textPricing, { vision: true })}
        model="test-model"
        provider="openai"
      />,
    );

    const evidenceRows = container.querySelectorAll('[data-evidence-state]');
    expect(evidenceRows).toHaveLength(2);
    expect(evidenceRows[0]).toHaveTextContent('Supported');
    expect(evidenceRows[1]).toHaveAttribute('data-evidence-state', 'unknown');
    expect(container).not.toHaveTextContent('No evidence');
  });

  it('omits unverified icons when evidence is incomplete', () => {
    globalState.status.modelDetailPanelExpandedKeys = ['pricing'];

    const { container } = render(
      <ModelDetailPanel
        enabledList={createEnabledList('openai', textPricing)}
        model="test-model"
        provider="openai"
      />,
    );

    expect(screen.queryByRole('img', { name: 'Unverified' })).toBeNull();
    expect(container.querySelector('[data-input-modality="text-only"]')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Text only' })).toBeNull();
  });
});
