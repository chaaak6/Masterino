import { useTranslation } from 'react-i18next';

import { isImageModelAvailable } from '@/helpers/imageModelAvailability';
import type { EnabledProviderWithModels } from '@/types/aiProvider';

import type { PricingMode } from '../components/ModelDetailPanel';

export const useGenerationModelDisabledReason = (
  enabledList: EnabledProviderWithModels[],
  pricingMode?: PricingMode,
) => {
  const { t } = useTranslation('components');
  return (modelId: string, providerId: string): string | undefined =>
    pricingMode === 'image' && !isImageModelAvailable(enabledList, modelId, providerId)
      ? t('ModelSwitchPanel.imageModelUnavailable')
      : undefined;
};
