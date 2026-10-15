import { isDesktop } from '@lobechat/const';
import { type MarkdownProps } from '@lobehub/ui';
import { Markdown } from '@lobehub/ui';
import { memo } from 'react';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { transformPreviewUrl } from './previewUrl';

const documentUrlTransform: NonNullable<
  NonNullable<MarkdownProps['reactMarkdownProps']>['urlTransform']
> = (url, key, node) => transformPreviewUrl(url, key, node.tagName, isDesktop);

const MarkdownMessage = memo<MarkdownProps>(
  ({ children, componentProps, reactMarkdownProps, ...rest }) => {
    const { highlighterTheme, mermaidTheme, fontSize } = useUserStore(
      userGeneralSettingsSelectors.config,
    );

    return (
      <Markdown
        fontSize={fontSize}
        reactMarkdownProps={{ urlTransform: documentUrlTransform, ...reactMarkdownProps }}
        variant={'chat'}
        componentProps={{
          ...componentProps,
          highlight: {
            fullFeatured: true,
            theme: highlighterTheme,
            ...componentProps?.highlight,
          },
          mermaid: { fullFeatured: false, theme: mermaidTheme, ...componentProps?.mermaid },
        }}
        {...rest}
      >
        {children}
      </Markdown>
    );
  },
);

export default MarkdownMessage;
