import { Markdown, type MarkdownProps } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { Element } from 'hast';
import {
  type ComponentProps,
  createContext,
  memo,
  use,
  useCallback,
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

interface WorkspaceDocument {
  deviceId?: string;
  filePath: string;
  goToFragment: (fragment: string) => void;
  onOpenFile: WorkspaceMarkdownProps['onOpenFile'];
  setNotice: (notice: 'file' | 'heading' | undefined) => void;
  workingDirectory: string;
}

const InlineImageContext = createContext(false);
const WorkspaceDocumentContext = createContext<WorkspaceDocument | null>(null);

const useWorkspaceDocument = () => {
  const document = use(WorkspaceDocumentContext);
  if (!document) throw new Error('Workspace Markdown components require the document context');
  return document;
};

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

const WorkspaceLink = ({
  children,
  href,
  node: _node,
  ...props
}: ComponentProps<'a'> & { node?: Element }) => {
  const { deviceId, filePath, goToFragment, onOpenFile, setNotice, workingDirectory } =
    useWorkspaceDocument();

  if (href && isExternal(href)) {
    return (
      <a
        {...props}
        href={href}
        rel="noreferrer"
        target={/^https?:/i.test(href) ? '_blank' : undefined}
      >
        <InlineImageContext value={true}>{children}</InlineImageContext>
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
      <InlineImageContext value={true}>{children}</InlineImageContext>
    </a>
  );
};

const WorkspaceParagraph = ({
  children,
  node,
  ...props
}: ComponentProps<'p'> & { node?: Element }) => {
  const onlyChild = node?.children.length === 1 && node.children[0];
  if (onlyChild && onlyChild.type === 'element' && /^(?:img|video)$/.test(onlyChild.tagName)) {
    return children;
  }

  // Image preview wraps standalone images in a div. Mixed paragraphs use inline images.
  return (
    <p {...props}>
      <InlineImageContext value={true}>{children}</InlineImageContext>
    </p>
  );
};

const WorkspaceImage = (props: ComponentProps<'img'> & { node?: Element }) => {
  const { deviceId, filePath, workingDirectory } = useWorkspaceDocument();
  return (
    <MarkdownImage
      {...props}
      deviceId={deviceId}
      inline={use(InlineImageContext)}
      markdownFilePath={filePath}
      workingDirectory={workingDirectory}
    />
  );
};

const components: MarkdownProps['components'] = {
  a: WorkspaceLink,
  img: WorkspaceImage,
  p: WorkspaceParagraph,
};

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

    const goToFragment = useCallback((fragment: string) => {
      const target = findFragment(root.current, fragment);
      setNotice(target ? undefined : 'heading');
      if (!target) return;

      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: 'nearest' });
    }, []);

    useEffect(() => {
      if (!navigation) return;

      goToFragment(navigation.fragment);
      onNavigationHandled?.(navigation.id);
    }, [goToFragment, navigation, onNavigationHandled]);

    const document = useMemo(
      () => ({ deviceId, filePath, goToFragment, onOpenFile, setNotice, workingDirectory }),
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
        <WorkspaceDocumentContext value={document}>
          <Markdown
            enableGithubAlert
            components={components}
            rehypePluginsAhead={workspaceMarkdownPlugins}
            style={{ paddingBlock: 8, paddingInline: 12 }}
          >
            {content}
          </Markdown>
        </WorkspaceDocumentContext>
      </div>
    );
  },
);

WorkspaceMarkdown.displayName = 'WorkspaceMarkdown';

export default WorkspaceMarkdown;
