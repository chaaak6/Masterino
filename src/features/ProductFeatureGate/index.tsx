import { type ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { getProductFeatureStatus, type ProductFeatureKey } from '@/config/productFeatures';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { redirectElement } from '@/utils/router';

import FeatureDisabledPage from './FeatureDisabledPage';

const RuntimeMemoryFeatureGate = ({ children }: { children: ReactElement }) => {
  const { enableMemory } = useServerConfigStore(featureFlagsSelectors);
  const { workspaceSlug } = useParams<{ workspaceSlug?: string }>();

  return enableMemory === true && !workspaceSlug ? children : <FeatureDisabledPage />;
};

export const featureGateElement = (featureKey: ProductFeatureKey, element: ReactElement) => {
  const status = getProductFeatureStatus(featureKey);

  if (status === 'enabled') {
    return featureKey === 'memory' ? (
      <RuntimeMemoryFeatureGate>{element}</RuntimeMemoryFeatureGate>
    ) : (
      element
    );
  }
  if (status === 'hidden') return redirectElement('/agent');

  return <FeatureDisabledPage />;
};
