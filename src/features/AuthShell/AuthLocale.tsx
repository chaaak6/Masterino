'use client';

import { ConfigProvider } from 'antd';
import { memo, type PropsWithChildren, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { isRtlLang } from 'rtl-detect';

import { getAntdLocale } from '@/utils/locale';

import { createAuthI18n } from './createAuthI18n';

interface AuthLocaleProps extends PropsWithChildren {
  defaultLang?: string;
}

const AuthLocale = memo<AuthLocaleProps>(({ children, defaultLang }) => {
  const [i18n] = useState(() => createAuthI18n(defaultLang));
  const [lang, setLang] = useState(defaultLang ?? 'en-US');

  const [antdLocale, setAntdLocale] = useState<Awaited<ReturnType<typeof getAntdLocale>>>();
  useEffect(() => {
    let active = true;
    void getAntdLocale(lang).then((value) => {
      if (active) setAntdLocale(value);
    });
    document.documentElement.dir = isRtlLang(lang) ? 'rtl' : 'ltr';
    return () => {
      active = false;
    };
  }, [lang]);

  if (!i18n.instance.isInitialized) {
    i18n.init();
  }

  useEffect(() => {
    const handleLang = (lng: string) => {
      setLang((prev) => (prev === lng ? prev : lng));
    };

    i18n.instance.on('languageChanged', handleLang);
    return () => {
      i18n.instance.off('languageChanged', handleLang);
    };
  }, [i18n]);

  const documentDir = isRtlLang(lang) ? 'rtl' : 'ltr';

  return (
    <I18nextProvider i18n={i18n.instance}>
      <ConfigProvider
        direction={documentDir}
        locale={antdLocale}
        theme={{
          components: {
            Button: {
              contentFontSizeSM: 12,
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </I18nextProvider>
  );
});

AuthLocale.displayName = 'AuthLocale';

export default AuthLocale;
