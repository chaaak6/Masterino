import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { createContext, type PropsWithChildren, use, useEffect, useRef, useState } from 'react';

import en from '../../../../locales/en-US/electron.json';
import vi from '../../../../locales/vi-VN/electron.json';
import zh from '../../../../locales/zh-CN/electron.json';
import { normalizeLocale } from '../../../../packages/locales/src/localeCodes';

const copyKeys = [
  'agentSelectLabel',
  'agentSelectPlaceholder',
  'clearSelectionLabel',
  'closeLabel',
  'customRegionLabel',
  'hintDragRegion',
  'hintDragTrigger',
  'hintExit',
  'hintHoverTrigger',
  'hintSelectWindow',
  'idlePlaceholder',
  'latestSelectionLabel',
  'modelSelectLabel',
  'modelSelectPlaceholder',
  'multipleSelectedPlaceholder',
  'newlineHint',
  'removeSelectionLabel',
  'screenshotLabel',
  'screenshotsLabel',
  'selectedPlaceholder',
  'selectionFormatLabel',
  'sendAriaLabel',
  'sendHint',
  'uploadFailedLabel',
  'uploadingLabel',
  'screenshotThumbnail',
] as const;

export const getOverlayCopy = (language: string) => {
  const locale = normalizeLocale(language);
  const resource = locale === 'zh-CN' ? zh : locale === 'vi-VN' ? vi : en;
  return Object.fromEntries(copyKeys.map((key) => [key, resource[`overlay.${key}`]])) as Record<
    (typeof copyKeys)[number],
    string
  >;
};

const LocaleContext = createContext(getOverlayCopy('en-US'));
export const useOverlayCopy = () => use(LocaleContext);

export const OverlayLocale = ({ children }: PropsWithChildren) => {
  const [locale, setLocale] = useState('en-US');
  const revision = useRef(0);
  useWatchBroadcast('localeChanged', ({ locale }) => {
    revision.current++;
    setLocale(normalizeLocale(locale === 'auto' ? navigator.language : locale));
  });
  useEffect(() => {
    let active = true;
    // Read the main process setting on mount and each capture session so hidden windows
    // also recover missed broadcasts. This never changes the AI response language.
    const update = async () => {
      const requestedRevision = ++revision.current;
      const state = await window.electronAPI?.invoke('system.getAppState');
      if (active && state && requestedRevision === revision.current)
        setLocale(normalizeLocale(state.locale === 'auto' ? navigator.language : state.locale));
    };
    void update().catch(console.error);
    const unsubscribe = window.electronAPI?.onScreenCaptureSession?.(() => {
      void update().catch(console.error);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <LocaleContext value={getOverlayCopy(locale)}>{children}</LocaleContext>;
};
