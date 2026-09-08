import { memo } from 'react';

import { ModelItemRender } from '@/components/ModelSelect';

import { type ModelWithProviders } from '../../types';

interface SingleProviderModelItemProps {
  data: ModelWithProviders;
  newLabel: string;
  proBadgeLabel?: string;
  showInfoTag?: boolean;
}

export const SingleProviderModelItem = memo<SingleProviderModelItemProps>(
  ({ data, newLabel, proBadgeLabel, showInfoTag }) => {
    return (
      <ModelItemRender
        disableTooltip
        visualOnly
        {...data.model}
        {...data.model.abilities}
        newBadgeLabel={newLabel}
        proBadgeLabel={proBadgeLabel}
        providerId={data.providers[0]?.id}
        showInfoTag={showInfoTag}
      />
    );
  },
);

SingleProviderModelItem.displayName = 'SingleProviderModelItem';
