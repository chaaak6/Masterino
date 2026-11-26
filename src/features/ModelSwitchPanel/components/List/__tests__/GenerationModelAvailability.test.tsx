/** @vitest-environment happy-dom */
import { DropdownMenuItem as ChatMenuItem } from '@lobehub/ui';
import {
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui/base-ui';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ModelParamsSchema } from 'model-bank';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import type { ListItem } from '@/features/ModelSwitchPanel/types';
import type { EnabledProviderWithModels } from '@/types/aiProvider';

import GenerationListItemRenderer from '../GenerationListItemRenderer';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/components/ModelSelect', () => ({
  ProviderItemRender: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock('@/features/ModelSwitchPanel/components/ModelDetailPanel', () => ({ default: () => null }));
vi.mock('@/features/ModelSwitchPanel/components/PanelContent', () => ({
  PanelContent: (props: {
    enabledList: EnabledProviderWithModels[];
    ModelItemComponent?: ComponentType<{ displayName: string }>;
    pricingMode: 'image' | 'video';
  }) =>
    props.ModelItemComponent ? (
      <GenerationListItemRenderer
        {...props}
        ModelItemComponent={props.ModelItemComponent}
        activeKey=""
        item={{
          type: 'provider-model-item',
          provider: props.enabledList[0],
          model: props.enabledList[0].children[0],
        }}
        onClose={vi.fn()}
        onModelChange={vi.fn()}
      />
    ) : (
      <ChatMenuItem>Chat model</ChatMenuItem>
    ),
}));

const model = (parameters?: ModelParamsSchema) => ({
  abilities: {},
  displayName: 'Image Alias',
  id: 'image-alias',
  parameters,
});
const valid = model({ prompt: { default: '' }, imageUrls: { default: [] } });
const missing = model();
const providers: EnabledProviderWithModels[] = [
  { id: 'missing', name: 'Missing configuration', source: 'builtin', children: [missing] },
  { id: 'ready', name: 'Ready provider', source: 'builtin', children: [valid] },
];

const mount = (item: ListItem, pricingMode: 'image' | 'video' = 'image') => {
  const onModelChange = vi.fn();
  const onClose = vi.fn();
  render(
    <DropdownMenuRoot open>
      <DropdownMenuTrigger>Models</DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner>
          <DropdownMenuPopup>
            <GenerationListItemRenderer
              ModelItemComponent={({ displayName }) => <span>{displayName}</span>}
              activeKey=""
              enabledList={providers}
              item={item}
              pricingMode={pricingMode}
              onClose={onClose}
              onModelChange={onModelChange}
            />
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>,
  );
  return { onModelChange, onClose };
};

describe('image model availability in the real dropdown primitives', () => {
  it('preserves the chat panel menu context', async () => {
    render(
      <ModelSwitchPanel open>
        <span>Models</span>
      </ModelSwitchPanel>,
    );
    expect(await screen.findByRole('menuitem', { name: 'Chat model' })).toBeInTheDocument();
  });
  it.each(['image', 'video'] as const)(
    'integrates the real panel root with generation rows (%s)',
    async (pricingMode) => {
      render(
        <ModelSwitchPanel
          open
          ModelItemComponent={({ displayName }) => <span>{displayName}</span>}
          enabledList={[providers[1]]}
          pricingMode={pricingMode}
        >
          <span>Models</span>
        </ModelSwitchPanel>,
      );
      expect(await screen.findByRole('menuitem', { name: 'Image Alias' })).toBeInTheDocument();
    },
  );

  it.each<ListItem>([
    { type: 'provider-model-item', model: missing, provider: providers[0] },
    {
      type: 'model-item-single',
      data: { displayName: 'Image Alias', model: missing, providers: [providers[0]] },
    },
    {
      type: 'model-item-multiple',
      data: {
        displayName: 'Image Alias',
        model: missing,
        providers: [providers[0], { ...providers[0], id: 'also-missing' }],
      },
    },
  ])('disables an unconfigured row and explains why ($type)', async (item) => {
    const { onModelChange, onClose } = mount(item);
    const row = await screen.findByRole('menuitem', { name: /Image Alias/ });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveTextContent('ModelSwitchPanel.imageModelUnavailable');
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onModelChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a configured image model selectable', async () => {
    const { onModelChange } = mount({
      type: 'provider-model-item',
      model: valid,
      provider: providers[1],
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Image Alias' }));
    expect(onModelChange).toHaveBeenCalledWith('image-alias', 'ready');
  });

  it('chooses a configured provider when the grouped model first provider is unavailable', async () => {
    const { onModelChange } = mount({
      type: 'model-item-multiple',
      data: { displayName: 'Image Alias', model: missing, providers },
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Image Alias' }));
    expect(onModelChange).toHaveBeenCalledWith('image-alias', 'ready');
  });

  it('does not apply image parameter requirements to video selection', async () => {
    const { onModelChange } = mount(
      { type: 'provider-model-item', model: missing, provider: providers[0] },
      'video',
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Image Alias' }));
    expect(onModelChange).toHaveBeenCalledWith('image-alias', 'missing');
  });
});
