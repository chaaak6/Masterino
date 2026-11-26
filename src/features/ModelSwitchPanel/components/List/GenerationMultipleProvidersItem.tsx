'use client';

import { Flexbox, menuSharedStyles } from '@lobehub/ui';
import {
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
} from '@lobehub/ui/base-ui';
import { cssVar, cx } from 'antd-style';
import { Check } from 'lucide-react';
import type { ComponentType } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProviderItemRender } from '@/components/ModelSelect';
import type { PricingMode } from '@/features/ModelSwitchPanel/components/ModelDetailPanel';
import ModelDetailPanel from '@/features/ModelSwitchPanel/components/ModelDetailPanel';
import { styles as modelSwitchPanelStyles } from '@/features/ModelSwitchPanel/styles';
import type { ListItem } from '@/features/ModelSwitchPanel/types';
import { menuKey } from '@/features/ModelSwitchPanel/utils';
import type { EnabledProviderWithModels } from '@/types/index';

import { useGenerationModelDisabledReason } from '../../hooks/useGenerationModelDisabledReason';
import UnavailableGenerationModel from './UnavailableGenerationModel';

interface GenerationMultipleProvidersItemProps {
  activeKey: string;
  enabledList: EnabledProviderWithModels[];
  item: Extract<ListItem, { type: 'model-item-multiple' }>;
  ModelItemComponent: ComponentType<any>;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => void;
  pricingMode?: PricingMode;
}

const GenerationMultipleProvidersItem = memo<GenerationMultipleProvidersItemProps>(
  ({ item, activeKey, onClose, onModelChange, enabledList, ModelItemComponent, pricingMode }) => {
    const { t } = useTranslation('components');
    const [subOpen, setSubOpen] = useState(false);
    const getDisabledReason = useGenerationModelDisabledReason(enabledList, pricingMode);
    const availableProviders = item.data.providers.filter(
      (p) => !getDisabledReason(item.data.model.id, p.id),
    );
    const activeProvider = availableProviders.find(
      (p) => menuKey(p.id, item.data.model.id) === activeKey,
    );
    const isActive = !!activeProvider;
    if (availableProviders.length === 0) {
      return (
        <UnavailableGenerationModel
          reason={getDisabledReason(item.data.model.id, item.data.providers[0].id)!}
        >
          <ModelItemComponent
            {...item.data.model}
            providerId={item.data.providers[0].id}
            showBadge={false}
            showPopover={false}
          />
        </UnavailableGenerationModel>
      );
    }

    return (
      <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
        <DropdownMenuSubmenuRoot open={subOpen} onOpenChange={setSubOpen}>
          <DropdownMenuSubmenuTrigger
            className={cx(menuSharedStyles.item, isActive && modelSwitchPanelStyles.menuItemActive)}
            style={{ paddingBlock: 8, paddingInline: 8 }}
            onClick={() => {
              setSubOpen(false);
              onModelChange(item.data.model.id, (activeProvider ?? availableProviders[0]).id);
              onClose();
            }}
          >
            <ModelItemComponent
              {...item.data.model}
              providerId={(activeProvider ?? availableProviders[0]).id}
              showBadge={false}
              showPopover={false}
            />
          </DropdownMenuSubmenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner anchor={null} placement="right" sideOffset={12}>
              <DropdownMenuPopup
                className={cx(
                  modelSwitchPanelStyles.detailPopup,
                  modelSwitchPanelStyles.dropdownMenu,
                )}
              >
                <ModelDetailPanel
                  enabledList={enabledList}
                  model={item.data.model.id}
                  pricingMode={pricingMode}
                  provider={(activeProvider ?? availableProviders[0]).id}
                />
                <Flexbox gap={4} paddingBlock={8} paddingInline={8}>
                  <Flexbox style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
                    {t('ModelSwitchPanel.useModelFrom')}
                  </Flexbox>
                  {item.data.providers.map((p) => {
                    const disabledReason = getDisabledReason(item.data.model.id, p.id);
                    const pKey = menuKey(p.id, item.data.model.id);
                    const isProviderActive = isActive ? activeKey === pKey : p.id === 'lobehub';
                    return (
                      <DropdownMenuItem
                        className={modelSwitchPanelStyles.menuItem}
                        disabled={!!disabledReason}
                        key={pKey}
                        onClick={() => {
                          if (disabledReason) return;
                          onModelChange(item.data.model.id, p.id);
                          onClose();
                        }}
                      >
                        <Flexbox gap={4}>
                          <ProviderItemRender
                            logo={p.logo}
                            name={p.name}
                            provider={p.id}
                            source={p.source}
                          />
                          {disabledReason && (
                            <span style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
                              {disabledReason}
                            </span>
                          )}
                        </Flexbox>
                        {isProviderActive ? <Check size={16} /> : null}
                      </DropdownMenuItem>
                    );
                  })}
                </Flexbox>
              </DropdownMenuPopup>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenuSubmenuRoot>
      </Flexbox>
    );
  },
);

GenerationMultipleProvidersItem.displayName = 'GenerationMultipleProvidersItem';

export default GenerationMultipleProvidersItem;
