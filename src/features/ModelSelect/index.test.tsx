/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ModelSelect from '.';

const selectMock = vi.fn();

vi.mock('@lobehub/ui', () => ({
  TooltipGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Select: (props: any) => {
    selectMock(props);
    return <button onClick={() => props.onChange('newapi/glm5-5.1', { provider: 'newapi' })} />;
  },
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    popup: 'popup',
    select: 'select',
  }),
}));

vi.mock('@/components/ModelSelect', () => ({
  ModelItemRender: ({ displayName, id }: { displayName?: string; id: string }) => (
    <span>{displayName || id}</span>
  ),
  ProviderItemRender: ({ name }: { name: string }) => <span>{name}</span>,
  TAG_CLASSNAME: 'model-tag',
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
      ],
      id: 'newapi',
      name: 'Aihub',
      source: 'builtin',
    },
  ],
}));

describe('ModelSelect', () => {
  it('canonicalizes Aihub GLM aliases in the controlled value and onChange payload', () => {
    const onChange = vi.fn();

    const { container } = render(
      <ModelSelect value={{ model: 'glm5-5.1', provider: 'newapi' }} onChange={onChange} />,
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
});
