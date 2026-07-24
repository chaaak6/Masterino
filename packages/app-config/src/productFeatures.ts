export type ProductFeatureStatus = 'enabled' | 'disabled' | 'hidden';

export type ProductFeatureKey =
  | 'advancedSettings'
  | 'chat'
  | 'groupChat'
  | 'settings'
  | 'community'
  | 'desktopApp'
  | 'generation'
  | 'resources'
  | 'pages'
  | 'memory'
  | 'tasks'
  | 'fleet'
  | 'eval'
  | 'devtools';

export interface ProductFeatureConfig {
  disabledReasonKey?: string;
  key: ProductFeatureKey;
  status: ProductFeatureStatus;
}

const DISABLED_REASON_KEY = 'productFeatures.disabled';

export const PRODUCT_FEATURES = {
  advancedSettings: {
    disabledReasonKey: DISABLED_REASON_KEY,
    key: 'advancedSettings',
    status: 'disabled',
  },
  chat: { key: 'chat', status: 'enabled' },
  community: { disabledReasonKey: DISABLED_REASON_KEY, key: 'community', status: 'disabled' },
  desktopApp: { disabledReasonKey: DISABLED_REASON_KEY, key: 'desktopApp', status: 'disabled' },
  devtools: { key: 'devtools', status: 'hidden' },
  eval: { key: 'eval', status: 'hidden' },
  fleet: { disabledReasonKey: DISABLED_REASON_KEY, key: 'fleet', status: 'disabled' },
  generation: { key: 'generation', status: 'enabled' },
  groupChat: { key: 'groupChat', status: 'enabled' },
  memory: { key: 'memory', status: 'enabled' },
  pages: { disabledReasonKey: DISABLED_REASON_KEY, key: 'pages', status: 'disabled' },
  resources: { disabledReasonKey: DISABLED_REASON_KEY, key: 'resources', status: 'disabled' },
  settings: { key: 'settings', status: 'enabled' },
  tasks: { disabledReasonKey: DISABLED_REASON_KEY, key: 'tasks', status: 'disabled' },
} as const satisfies Record<ProductFeatureKey, ProductFeatureConfig>;

export const getProductFeature = (key: ProductFeatureKey): ProductFeatureConfig =>
  PRODUCT_FEATURES[key];

export const getProductFeatureStatus = (key: ProductFeatureKey): ProductFeatureStatus =>
  getProductFeature(key).status;

export const isProductFeatureEnabled = (key: ProductFeatureKey) =>
  getProductFeatureStatus(key) === 'enabled';

export const isProductFeatureDisabled = (key: ProductFeatureKey) =>
  getProductFeatureStatus(key) === 'disabled';

export const isProductFeatureHidden = (key: ProductFeatureKey) =>
  getProductFeatureStatus(key) === 'hidden';
