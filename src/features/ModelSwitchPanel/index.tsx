import {
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  stopPropagation,
  TooltipGroup,
} from '@lobehub/ui';
import * as GenerationMenu from '@lobehub/ui/base-ui';
import { memo, useCallback, useState } from 'react';

import { requestPanelModelCatalogCheck } from '@/features/SilentModelRefresh/controller';
import { useAiInfraStore } from '@/store/aiInfra';

import { PanelContent } from './components/PanelContent';
import { styles } from './styles';
import { type ModelSwitchPanelProps } from './types';

const ModelSwitchPanel = memo<ModelSwitchPanelProps>(
  ({
    ModelItemComponent,
    children,
    enabledList,
    model: modelProp,
    onModelChange,
    onOpenChange,
    open,
    placement = 'topLeft',
    pricingMode,
    provider: providerProp,
    openOnHover = true,
  }) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const isOpen = open ?? internalOpen;
    // Generation rows use base-ui; their root and portal must share that menu context.
    const Root = ModelItemComponent ? GenerationMenu.DropdownMenuRoot : DropdownMenuRoot;
    const Trigger = ModelItemComponent ? GenerationMenu.DropdownMenuTrigger : DropdownMenuTrigger;
    const Portal = ModelItemComponent ? GenerationMenu.DropdownMenuPortal : DropdownMenuPortal;
    const Positioner = ModelItemComponent
      ? GenerationMenu.DropdownMenuPositioner
      : DropdownMenuPositioner;
    const Popup = ModelItemComponent ? GenerationMenu.DropdownMenuPopup : DropdownMenuPopup;

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        setInternalOpen(nextOpen);
        if (
          nextOpen &&
          !pricingMode &&
          (enabledList !== undefined || !requestPanelModelCatalogCheck())
        )
          void useAiInfraStore
            .getState()
            .refreshAiProviderRuntimeState()
            .catch(() => {});
        onOpenChange?.(nextOpen);
      },
      [enabledList, onOpenChange, pricingMode],
    );

    return (
      <TooltipGroup>
        <Root open={isOpen} onOpenChange={handleOpenChange}>
          <Trigger className={styles.trigger} openOnHover={openOnHover}>
            {children}
          </Trigger>
          <Portal>
            <Positioner hoverTrigger={openOnHover} placement={placement}>
              <Popup className={styles.container} onKeyDown={stopPropagation}>
                <PanelContent
                  ModelItemComponent={ModelItemComponent}
                  enabledList={enabledList}
                  model={modelProp}
                  pricingMode={pricingMode}
                  provider={providerProp}
                  onModelChange={onModelChange}
                  onOpenChange={handleOpenChange}
                />
              </Popup>
            </Positioner>
          </Portal>
        </Root>
      </TooltipGroup>
    );
  },
);

ModelSwitchPanel.displayName = 'ModelSwitchPanel';

export default ModelSwitchPanel;

export { type ModelSwitchPanelProps } from './types';
