import { Markdown, type MarkdownProps } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import {
  type ComponentProps,
  createContext,
  memo,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { resolveMarkdownRelativeAssetPath } from './Body.helpers';
import MarkdownImage from './MarkdownImage';
import { workspaceMarkdownPlugins } from './workspaceMarkdownPlugins';

interface WorkspaceFileLink {
  deviceId?: string;
  filePath: string;
  fragment?: string;
  workingDirectory: string;
}

interface WorkspaceMarkdownProps {
  content: string;
  deviceId?: string;
  filePath: string;
  navigation?: { fragment: string; id: string };
  onNavigationHandled?: (requestId: string) => void;
  onOpenFile: (target: WorkspaceFileLink) => void;
  workingDirectory: string;
}

const LinkedImage = createContext(false);

const decodeFragment = (fragment: string) => {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
};

const isExternal = (href: string) => /^(?:https?:\/\/|mailto:)/i.test(href);

const findFragment = (container: HTMLDivElement | null, fragment: string) =>
  container &&
  Array.from(container.querySelectorAll<HTMLElement>('[data-workspace-heading], [id]')).find(
    (element) =>
      element.dataset.workspaceHeading === fragment || element.id === 'user-content-' + fragment,
  );

const WorkspaceMarkdown = memo<WorkspaceMarkdownProps>(
  ({
    content,
    deviceId,
    filePath,
    navigation,
    onNavigationHandled,
    onOpenFile,
    workingDirectory,
  }) => {
    const { t } = useTranslation('chat');
    const root = useRef<HTMLDivElement>(null);
    const [notice, setNotice] = useState<'file' | 'heading'>();

    const goToFragment = useMemo(
      () => (fragment: string) => {
        const target = findFragment(root.current, fragment);
        setNotice(target ? undefined : 'heading');
        if (!target) return;

        target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView?.({ block: 'nearest' });
      },
      [],
    );

    useEffect(() => {
      if (!navigation) return;

      goToFragment(navigation.fragment);
      onNavigationHandled?.(navigation.id);
    }, [goToFragment, navigation, onNavigationHandled]);

    const components = useMemo<MarkdownProps['components']>(
      () => ({
        a: function WorkspaceLink({ children, href, node: _node, ...props }) {
          if (href && isExternal(href)) {
            return (
              <a
                {...props}
                href={href}
                rel="noreferrer"
                target={/^https?:/i.test(href) ? '_blank' : undefined}
              >
                <LinkedImage value={true}>{children}</LinkedImage>
              </a>
            );
          }

          const hashIndex = href?.indexOf('#') ?? -1;
          const fragment = hashIndex >= 0 && href ? decodeFragment(href.slice(hashIndex + 1)) : '';
          const target = resolveMarkdownRelativeAssetPath({
            markdownFilePath: filePath,
            src: href,
            workingDirectory,
          });
          return (
            <a
              {...props}
              href={href?.startsWith('#') ? '#' + encodeURIComponent(fragment) : '#'}
              onClick={(event) => {
                event.preventDefault();
                if (href?.startsWith('#')) {
                  goToFragment(fragment);
                } else if (target) {
                  setNotice(undefined);
                  onOpenFile({
                    deviceId,
                    filePath: target,
                    ...(fragment ? { fragment } : {}),
                    workingDirectory,
                  });
                } else {
                  setNotice('file');
                }
              }}
            >
              <LinkedImage value={true}>{children}</LinkedImage>
            </a>
          );
        },
        img: function WorkspaceImage(props: ComponentProps<'img'> & { node?: unknown }) {
          return (
            <MarkdownImage
              {...props}
              deviceId={deviceId}
              linked={use(LinkedImage)}
              markdownFilePath={filePath}
              workingDirectory={workingDirectory}
            />
          );
        },
      }),
      [deviceId, filePath, goToFragment, onOpenFile, workingDirectory],
    );

    return (
      <div ref={root}>
        {notice && (
          <div
            role="status"
            style={{
              background: cssVar.colorBgContainer,
              paddingInline: 12,
              position: 'sticky',
              top: 0,
              zIndex: 1,
            }}
          >
            {t(
              notice === 'file'
                ? 'workingPanel.localFile.error'
                : 'workingPanel.localFile.preview.headingNotFound',
            )}
          </div>
        )}
        <Markdown
          components={components}
          enableGithubAlert
          rehypePluginsAhead={workspaceMarkdownPlugins}
          style={{ paddingBlock: 8, paddingInline: 12 }}
        >
          {content}
        </Markdown>
      </div>
    );
  },
);

WorkspaceMarkdown.displayName = 'WorkspaceMarkdown';

export default WorkspaceMarkdown;
