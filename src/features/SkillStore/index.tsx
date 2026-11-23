'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { isDesktop } from '@/const/version';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';

import { SkillStoreContent,type SkillStoreOptions } from './SkillStoreContent';

let active:
  | {
      close: () => void;
      instance: ReturnType<typeof createModal>;
      setup?: SkillStoreOptions['setup'];
    }
  | undefined;
let navigation = 0;

export const createSkillStoreModal = (options: SkillStoreOptions = {}) => {
  if (active?.setup) return;
  const renderContent = (close: () => void) => (
    <MarketAuthProvider isDesktop={isDesktop}>
      <SkillStoreContent
        key={++navigation}
        {...options}
        onUseLocal={
          options.onUseLocal &&
          ((server) => {
            close();
            options.onUseLocal?.(server);
          })
        }
      />
    </MarketAuthProvider>
  );
  if (active) {
    if (options.openLocal) {
      active.setup = options.setup;
      active.instance.update({ children: renderContent(active.close) });
    }
    return active.close;
  }

  const dismiss = () => {
    if (active?.instance !== instance) return;
    const setup = active.setup;
    active = undefined;
    setup?.onClose();
  };
  const close = () => {
    dismiss();
    instance.close();
  };
  const instance = createModal({
    children: renderContent(close),
    footer: null,
    onOpenChange: (open) => {
      if (!open) dismiss();
    },
    onOpenChangeComplete: (open) => {
      if (!open) dismiss();
    },
    title: t('skillStore.title', { ns: 'setting' }),
    width: 'min(80%, 800px)',
  });
  active = { close, instance, setup: options.setup };
  return close;
};
