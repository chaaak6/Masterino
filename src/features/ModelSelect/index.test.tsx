/**
 * @vitest-environment happy-dom
 */
import { classifyModelKindById } from '@lobechat/business-model-bank';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ModelSelect from '.';

const selectMock = vi.fn();
const modelItemMock = vi.fn();

vi.mock('@lobehub/ui', () => ({
  Avatar: () => null,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  Tag: () => null,
  Text: () => null,
  Tooltip: () => null,
  TooltipGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Select: (props: any) => {
    selectMock(props);
    return <button onClick={() => props.onChange('newapi/glm-5.1', { id: 'glm-5.1', provider: 'newapi' })} />;
  },
  Tooltip: () => null,
}));

vi.mock('@lobehub/icons', () => ({
  LobeHub: { Morden: () => null },
  ModelIcon: () => null,
  ProviderIcon: () => null,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_, key) => String(key) }),
  cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }),
  cx: (...classNames: unknown[]) => classNames.filter(Boolean).join(' '),
  useResponsive: () => ({ mobile: false }),
}));

// Keep the real catalog hooks so the eligibility gate under test is the production one.
vi.mock('@/components/ModelSelect', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ModelItemRender: (props: { displayName?: string; id: string; providerId?: string }) => {
    modelItemMock(props);
    classifyModelKindById(props.id);
    return <span>{props.displayName || props.id}</span>;
  },
  ProviderItemRender: ({ name }: { name: string }) => <span>{name}</span>,
}));

const storeState = {
  enabledAiModels: [
    { abilities: { functionCall: true }, id: 'glm-5.1', providerId: 'newapi', type: 'chat' },
    // legacy remote rows whose type still says chat; B1 reclassifies them from the id
    { abilities: {}, id: 'qwen3-vl-rerank', providerId: 'newapi', type: 'chat' },
    { abilities: {}, id: 'text-embedding-3-small', providerId: 'newapi', type: 'embedding' },
    { abilities: {}, id: 'text-embedding-3-large', providerId: 'newapi', type: 'embedding' },
    { abilities: {}, id: 'qwen3-vl-rerank', providerId: 'newapi', type: 'embedding' },
  ],
  enabledAiProviders: [{ id: 'newapi', name: 'Aihub' }],
};

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: () => [
    {
      children: [
        {
          abilities: { functionCall: true, reasoning: true, search: true },
          displayName: 'GLM-5.1',
          id: 'glm-5.1',
        },
        { abilities: {}, displayName: 'Qwen3 VL Rerank', id: 'qwen3-vl-rerank' },
        { abilities: {}, displayName: 'Embedding', id: 'text-embedding-3-small' },
      ],
      id: 'newapi',
      name: 'Aihub',
      source: 'builtin',
    },
  ],
}));

describe('ModelSelect', () => {
  it('passes Aihub model ids through like other providers', () => {
    const onChange = vi.fn();

    const { container } = render(
      <ModelSelect value={{ model: 'glm-5.1', provider: 'newapi' }} onChange={onChange} />,
    );

    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultValue: 'newapi/glm-5.1',
        value: 'newapi/glm-5.1',
      }),
    );

    container.querySelector('button')?.click();

    expect(onChange).toHaveBeenCalledWith({ model: 'glm-5.1', provider: 'newapi' });
  });

  it('only offers B1 chat-eligible rows, never a rerank or embedding model', () => {
    render(<ModelSelect value={{ model: 'glm-5.1', provider: 'newapi' }} />);

    const { options } = selectMock.mock.calls.at(-1)![0];
    expect(options.map((option: { value: string }) => option.value)).toEqual(['newapi/glm-5.1']);

    // the row label carries the provider so the catalog lookup matches the exact pair
    expect(
      options.map((option: { label: { props: { id: string } } }) => option.label.props.id),
    ).toEqual(['glm-5.1']);
    expect(options[0].label.props).toMatchObject({ id: 'glm-5.1', providerId: 'newapi' });
  });

  it('renders a saved embedding that is absent from available options without crashing', () => {
    const onChange = vi.fn();
    render(
      <ModelSelect
        modelType="embedding"
        value={{ model: 'text-embedding-3-small', provider: 'newapi' }}
        onChange={onChange}
      />,
    );

    const { onChange: selectOnChange, optionRender, options } = selectMock.mock.calls.at(-1)![0];
    expect(options.map((option: { value: string }) => option.value)).toEqual([
      'newapi/text-embedding-3-large',
    ]);
    // base-ui Select synthesizes this minimal option when the controlled value
    // is missing from its current options (for example, a stale saved model).
    expect(() =>
      render(optionRender({ label: 'newapi/text-embedding-3-small', value: 'newapi/text-embedding-3-small' })),
    ).not.toThrow();
    selectOnChange('newapi/text-embedding-3-small', {
      label: 'newapi/text-embedding-3-small',
      value: 'newapi/text-embedding-3-small',
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
