import { Flexbox } from '@lobehub/ui';
import { type ComponentType, type FC } from 'react';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Rnd } from 'react-rnd';

import { useBusinessModelPricingPrefetch } from '@/business/client/hooks/useBusinessModelPricing';
import { useChatEligibleModelList } from '@/components/ModelSelect';
import {
  getCatalogCheckStatus,
  retryPanelModelCatalogCheck,
  subscribeCatalogCheckStatus,
} from '@/features/SilentModelRefresh/controller';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors/general';
import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { DEFAULT_WIDTH, ENABLE_RESIZING, MAX_WIDTH, MIN_WIDTH } from '../const';
import { usePanelSize } from '../hooks/usePanelSize';
import { usePanelState } from '../hooks/usePanelState';
import { styles } from '../styles';
import { List } from './List';
import type { PricingMode } from './ModelDetailPanel';
import { Toolbar } from './Toolbar';

interface PanelContentProps {
  enabledList?: EnabledProviderWithModels[];
  model?: string;
  ModelItemComponent?: ComponentType<any>;
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  pricingMode?: PricingMode;
  provider?: string;
}

export const PanelContent: FC<PanelContentProps> = ({
  ModelItemComponent,
  enabledList: enabledListProp,
  model: modelProp,
  onModelChange: onModelChangeProp,
  onOpenChange,
  pricingMode,
  provider: providerProp,
}) => {
  // Generation UIs pass their own list; the chat path only consumes B1 chat-eligible rows.
  const chatEnabledList = useChatEligibleModelList();
  const enabledList = enabledListProp ?? chatEnabledList;
  const [searchKeyword, setSearchKeyword] = useState('');
  const { t } = useTranslation('components');
  const catalogCheckStatus = useSyncExternalStore(subscribeCatalogCheckStatus, getCatalogCheckStatus);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const { groupMode, handleGroupModeChange } = usePanelState();
  const { panelHeight, panelWidth, handlePanelWidthChange } = usePanelSize(enabledList.length);

  useBusinessModelPricingPrefetch();

  const content = (
    <>
      <Toolbar
        groupMode={groupMode}
        searchKeyword={searchKeyword}
        showGroupModeSwitch={isDevMode}
        onGroupModeChange={handleGroupModeChange}
        onSearchKeywordChange={setSearchKeyword}
      />
      {catalogCheckStatus === 'error' && enabledListProp === undefined && !pricingMode && (
        <div className={styles.catalogStatus}>
          {t('ModelSwitchPanel.catalogCheckFailed')}{' '}
          <button className={styles.catalogRetry} type="button" onClick={retryPanelModelCatalogCheck}>
            {t('ModelSwitchPanel.catalogRetry')}
          </button>
        </div>
      )}
      <List
        ModelItemComponent={ModelItemComponent}
        enabledList={enabledList}
        groupMode={isDevMode ? groupMode : 'byModel'}
        model={modelProp}
        pricingMode={pricingMode}
        provider={providerProp}
        searchKeyword={searchKeyword}
        onModelChange={onModelChangeProp}
        onOpenChange={onOpenChange}
      />
    </>
  );

  if (isDevMode) {
    return (
      <Rnd
        disableDragging
        enableResizing={ENABLE_RESIZING}
        maxWidth={MAX_WIDTH}
        minWidth={MIN_WIDTH}
        position={{ x: 0, y: 0 }}
        size={{ height: panelHeight, width: panelWidth }}
        style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}
        onResizeStop={(_e, _direction, ref) => {
          handlePanelWidthChange(ref.offsetWidth);
        }}
      >
        {content}
      </Rnd>
    );
  }

  return (
    <Flexbox
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: panelHeight,
        position: 'relative',
        width: DEFAULT_WIDTH,
      }}
    >
      {content}
    </Flexbox>
  );
};
