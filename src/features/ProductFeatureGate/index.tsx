import { type ReactElement } from 'react';

import { type ProductFeatureKey, getProductFeatureStatus } from '@/config/productFeatures';
import { redirectElement } from '@/utils/router';

import FeatureDisabledPage from './FeatureDisabledPage';

export const featureGateElement = (featureKey: ProductFeatureKey, element: ReactElement) => {
  const status = getProductFeatureStatus(featureKey);

  if (status === 'enabled') return element;
  if (status === 'hidden') return redirectElement('/agent');

  return <FeatureDisabledPage />;
};
