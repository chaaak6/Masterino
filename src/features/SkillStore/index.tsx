'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { SkillStoreContent, type SkillStoreOptions } from './SkillStoreContent';

interface SkillStoreSession {
  close: () => void;
  instance: ReturnType<typeof createModal>;
  localOpened: boolean;
  options: SkillStoreOptions;
  setup?: SkillStoreOptions['setup'];
}

let active: SkillStoreSession | undefined;
let navigation = 0;

const renderContent = (options: SkillStoreOptions, close: () => void) => (
  <SkillStoreContent
    key={navigation}
    {...options}
    onLocalOpened={() => {
      if (active?.close === close) active.localOpened = true;
    }}
    onUseLocal={
      options.onUseLocal &&
      ((server) => {
        close();
        options.onUseLocal?.(server);
      })
    }
  />
);

export const createSkillStoreModal = (options: SkillStoreOptions = {}) => {
  if (active?.setup) return;
  if (active) {
    const session = active;
    if (options.setup) {
      // Keep the market page mounted so its tab and search survive chat setup.
      if (session.localOpened) return;
      session.setup = options.setup;
      session.instance.update({
        children: renderContent({ ...session.options, setup: options.setup }, session.close),
      });
      return () => {
        if (active !== session) return;
        session.setup = undefined;
        session.instance.update({ children: renderContent(session.options, session.close) });
      };
    }

    if (options.openLocal && !session.localOpened) {
      session.options = options;
      session.localOpened = true;
      navigation += 1;
      session.instance.update({ children: renderContent(options, session.close) });
    }
    return session.close;
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
    children: renderContent(options, close),
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
  active = {
    close,
    instance,
    localOpened: Boolean(options.openLocal),
    options,
    setup: options.setup,
  };
  return close;
};
