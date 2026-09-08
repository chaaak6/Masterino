/**
 * @vitest-environment happy-dom
 */
import { render, within } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  CHAT_FIXTURES,
  enabledModel,
  PROVIDER,
} from '@/components/ModelSelect/__tests__/catalogFixtures';
import type { EnabledProviderWithModels } from '@/types/aiProvider';

import ModelDetailPanel from '../../ModelDetailPanel';
import { SingleProviderModelItem } from '../SingleProviderModelItem';

const storeState = {
  enabledAiModels: [
    enabledModel(CHAT_FIXTURES.supported),
    enabledModel(CHAT_FIXTURES.textOnly),
    enabledModel(CHAT_FIXTURES.unknown),
  ],
};

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

const enabledList: EnabledProviderWithModels[] = [
  {
    children: [
      { abilities: {}, displayName: 'Qwen3 VL Plus', id: 'qwen3-vl-plus' },
      { abilities: {}, displayName: 'GLM-5.1', id: 'glm-5.1' },
      { abilities: {}, displayName: 'DeepSeek V4', id: 'deepseek-v4' },
    ],
    id: PROVIDER,
    name: 'Aihub',
    source: 'builtin',
  },
];

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: () => enabledList,
}));

vi.mock('@/business/client/hooks/useBusinessModelPricing', () => ({
  useBusinessModelPricing:
    () =>
    ({ pricing }: { pricing?: unknown }) =>
      pricing,
}));

const globalState = {
  status: { modelDetailPanelExpandedKeys: ['abilities'] },
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replaceAll(/\{\{(\w+)\}\}/g, (_, name) =>
        String(options?.[name] ?? ''),
      ),
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_, key) => String(key) }),
  cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }),
  cx: (...classNames: unknown[]) => classNames.filter(Boolean).join(' '),
  useResponsive: () => ({ mobile: false }),
}));

vi.mock('@lobehub/icons', () => ({
  LobeHub: { Morden: () => <span /> },
  ModelIcon: () => <span />,
  ProviderIcon: () => <span />,
}));

type Props = HTMLAttributes<HTMLElement> & {
  action?: ReactNode;
  children?: ReactNode;
  title?: ReactNode;
};

// Mock factories are hoisted above module constants, so these helpers must be hoisted too.
const { Box, TooltipMock } = vi.hoisted(() => {
  const Box = ({ children, className }: Props) => <div className={className}>{children}</div>;
  const TooltipMock = ({ children, title }: Props) => (
    <span>
      <span data-testid="tooltip-title">{title}</span>
      {children}
    </span>
  );

  return { Box, TooltipMock };
});

vi.mock('@lobehub/ui', () => ({
  Accordion: Box,
  AccordionItem: ({ action, children, title }: Props) => (
    <section>
      <div>{title}</div>
      <div>{action}</div>
      <div>{children}</div>
    </section>
  ),
  Avatar: () => <span />,
  Flexbox: Box,
  Icon: () => <i />,
  Tag: ({ children, ...rest }: Props) => <span {...rest}>{children}</span>,
  Text: ({ children }: Props) => <span>{children}</span>,
  Tooltip: TooltipMock,
  TooltipGroup: ({ children }: Props) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tooltip: TooltipMock,
}));

const cases = [
  {
    detailLabel: 'Image input',
    id: 'qwen3-vl-plus',
    imageEvidence: 'Supported · Provider metadata · Verified 2026-09-01',
    kind: 'supported',
    rowLabel: 'Supports image input',
  },
  {
    detailLabel: 'Text only',
    id: 'glm-5.1',
    imageEvidence: 'Unsupported · Provider metadata · Verified 2026-09-01',
    kind: 'text-only',
    rowLabel: 'Text only',
  },
  {
    detailLabel: 'Unverified',
    id: 'deepseek-v4',
    imageEvidence: 'Unverified · No evidence · Not verified yet',
    kind: 'unknown',
    rowLabel: 'Unverified',
  },
];

describe('ModelSwitchPanel row and detail input modality', () => {
  it.each(cases)(
    '$id: the list row and the detail panel state the same $kind conclusion',
    ({ id, kind, rowLabel }) => {
      const row = render(
        <SingleProviderModelItem
          newLabel="new"
          showInfoTag={false}
          data={{
            displayName: id,
            model: { abilities: {}, displayName: id, id } as any,
            providers: [{ id: PROVIDER, name: 'Aihub' }],
          }}
        />,
      );
      if (kind === 'supported') {
        expect(within(row.container).getByRole('img', { name: rowLabel })).toBeInTheDocument();
      } else {
        expect(within(row.container).queryByRole('img')).toBeNull();
      }
      expect(row.container.querySelector('[data-testid="tooltip"]')).toBeNull();
      const detail = render(<ModelDetailPanel model={id} provider={PROVIDER} />);
      const evidenceRows = detail.container.querySelectorAll('[data-evidence-state]');
      expect(evidenceRows).toHaveLength(2);
      expect(evidenceRows[0]).toHaveAttribute(
        'data-evidence-state',
        kind === 'text-only' ? 'unsupported' : kind,
      );
    },
  );

  it('never lets an unverified model read as text only anywhere', () => {
    const row = render(
      <SingleProviderModelItem
        newLabel="new"
        showInfoTag={false}
        data={{
          displayName: 'deepseek-v4',
          model: { abilities: {}, displayName: 'deepseek-v4', id: 'deepseek-v4' } as any,
          providers: [{ id: PROVIDER, name: 'Aihub' }],
        }}
      />,
    );
    const detail = render(<ModelDetailPanel model="deepseek-v4" provider={PROVIDER} />);

    expect(within(row.container).queryByRole('img', { name: 'Text only' })).toBeNull();
    expect(detail.container.querySelector('[data-input-modality="text-only"]')).toBeNull();
    expect(detail.container.querySelector('[data-evidence-state]')).toHaveAttribute(
      'data-evidence-state',
      'unknown',
    );
  });
});
