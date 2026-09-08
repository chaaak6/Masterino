/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ModelItemRender } from '.';
import { CHAT_FIXTURES, enabledModel, PROVIDER, rerankCatalog } from './__tests__/catalogFixtures';

const storeState = {
  enabledAiModels: [
    enabledModel(CHAT_FIXTURES.supported, { functionCall: true }),
    enabledModel(CHAT_FIXTURES.textOnly, { functionCall: true }),
    enabledModel(CHAT_FIXTURES.unknown, { functionCall: true }),
    enabledModel(rerankCatalog()),
  ],
};

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
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
  ModelIcon: () => <span data-testid="model-icon" />,
  ProviderIcon: () => <span />,
}));

type Props = HTMLAttributes<HTMLElement> & { children?: ReactNode; title?: ReactNode };

// Mock factories are hoisted above module constants, so these helpers must be hoisted too.
const { Box, TooltipMock } = vi.hoisted(() => {
  const Box = ({ children, className, style }: Props) => (
    <div className={className} style={style}>
      {children}
    </div>
  );
  const TooltipMock = ({ children, title }: Props) => (
    <span data-testid="tooltip">
      <span data-testid="tooltip-title">{title}</span>
      {children}
    </span>
  );

  return { Box, TooltipMock };
});

vi.mock('@lobehub/ui', () => ({
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

const renderRow = (id: string, extra: Record<string, unknown> = {}) =>
  render(
    <ModelItemRender
      displayName={id}
      id={id}
      providerId={PROVIDER}
      showInfoTag={false}
      {...extra}
    />,
  );

describe('ModelItemRender input modality conclusion', () => {
  it('shows an accessible image icon with source and verification for supported evidence', () => {
    renderRow('qwen3-vl-plus');

    const tag = screen.getByRole('img', { name: 'Supports image input' });
    expect(tag).toHaveAttribute('data-input-modality', 'supported');
    expect(screen.queryByRole('img', { name: 'Text only' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Unverified' })).not.toBeInTheDocument();

    const tooltip = screen.getByTestId('tooltip-title');
    expect(tooltip).toHaveTextContent('Supports image input');
    expect(tooltip).toHaveTextContent('Image input: Supported · Source: Provider metadata');
    expect(tooltip).toHaveTextContent('Verified 2026-09-01');
  });

  it('marks four explicit rejections as text only', () => {
    renderRow('glm-5.1');

    const tag = screen.getByRole('img', { name: 'Text only' });
    expect(tag).toHaveAttribute('data-input-modality', 'text-only');
    expect(screen.queryByRole('img', { name: 'Unverified' })).not.toBeInTheDocument();
    expect(screen.getByTestId('tooltip-title')).toHaveTextContent(
      'Only text input is supported. Image, audio, video and file input are unsupported.',
    );
    expect(screen.getByTestId('tooltip-title')).toHaveTextContent(
      'Audio input: Unsupported · Source: Provider metadata',
    );
  });

  it('keeps incomplete evidence as unverified, never as text only', () => {
    renderRow('deepseek-v4');

    const tag = screen.getByRole('img', { name: 'Unverified' });
    expect(tag).toHaveAttribute('data-input-modality', 'unknown');
    expect(tag.className).toContain('unverified');
    expect(screen.queryByRole('img', { name: 'Text only' })).not.toBeInTheDocument();

    const tooltip = screen.getByTestId('tooltip-title');
    expect(tooltip).toHaveTextContent(
      'Input modality evidence is incomplete. Not yet verified: Image input, Audio input, Video input, File input.',
    );
    expect(tooltip).toHaveTextContent('Image input: Unverified · Source: No evidence');
    expect(tooltip).toHaveTextContent('Not verified yet');
  });

  it('keeps the conclusion when developer mode info tags are off and adds them when on', () => {
    const { unmount } = renderRow('qwen3-vl-plus', { functionCall: true, showInfoTag: false });
    expect(screen.getByRole('img', { name: 'Supports image input' })).toBeInTheDocument();
    expect(screen.queryByText('ModelSelect.featureTag.functionCall')).not.toBeInTheDocument();
    unmount();

    renderRow('qwen3-vl-plus', { functionCall: true, showInfoTag: true, vision: true });
    expect(screen.getByRole('img', { name: 'Supports image input' })).toBeInTheDocument();
    // tool calling stays an independent tag; vision now comes from evidence, not the boolean
    expect(screen.getByText('ModelSelect.featureTag.functionCall')).toBeInTheDocument();
    expect(screen.queryByText('ModelSelect.featureTag.vision')).not.toBeInTheDocument();
  });

  it('renders no modality claim for a row B1 does not classify as chat', () => {
    renderRow('qwen3-vl-rerank');

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(document.querySelector('[data-input-modality]')).toBeNull();
  });

  it('can be switched off explicitly for compact selected states', () => {
    renderRow('qwen3-vl-plus', { showInputModality: false });

    expect(document.querySelector('[data-input-modality]')).toBeNull();
  });
});

describe('visual-only switch panel rows', () => {
  it('shows supported image capability without a nested tooltip', () => {
    renderRow('qwen3-vl-plus', { visualOnly: true, disableTooltip: true });
    expect(screen.getByRole('img', { name: 'Supports image input' })).toBeInTheDocument();
    expect(screen.queryByTestId('tooltip')).toBeNull();
  });
  it.each(['glm-5.1', 'deepseek-v4'])('omits placeholder icons for %s', (id) => {
    renderRow(id, { visualOnly: true, disableTooltip: true });
    expect(screen.queryByRole('img')).toBeNull();
  });
});
