'use client';

import { EditorProvider } from '@lobehub/editor/react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const Editor = memo<PropsWithChildren>(({ children }) => {
  const { i18n } = useTranslation('editor');
  const language = i18n?.language;

  // The namespace can arrive after the language change; read on every resource-driven render.
  const localization =
    language && typeof i18n?.getResourceBundle === 'function'
      ? {
          ...i18n.getResourceBundle('en-US', 'editor'),
          ...i18n.getResourceBundle(language, 'editor'),
        }
      : undefined;

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
