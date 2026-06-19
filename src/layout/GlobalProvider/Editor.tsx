'use client';

import { EditorProvider } from '@lobehub/editor/react';
import { type PropsWithChildren } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const Editor = memo<PropsWithChildren>(({ children }) => {
  const { i18n } = useTranslation('editor');
  const language = i18n?.language;

  const localization = useMemo(() => {
    if (!language || typeof i18n?.getResourceBundle !== 'function') return undefined;

    return i18n.getResourceBundle(language, 'editor');
  }, [i18n, language]);

  return (
    <EditorProvider
      config={{
        locale: localization,
      }}
    >
      {children}
    </EditorProvider>
  );
});

Editor.displayName = 'Editor';

export default Editor;
