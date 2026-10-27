'use client';

import {
  readBoundedSkillBody,
  SKILL_EXPANDED_MAX_BYTES,
  SKILL_MAX_ENTRIES,
  SKILL_PACKAGE_MAX_BYTES,
} from '@lobechat/skill-package';
import { type SkillResourceTreeNode } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ActionIcon, Avatar, Button, Flexbox, Icon } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { unzip } from 'fflate';
import { DotIcon, ExternalLinkIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PublishedTime from '@/components/PublishedTime';
import ContentViewer from '@/features/AgentSkillDetail/ContentViewer';
import FileTree from '@/features/FileTree';
import { marketApiService } from '@/services/marketApi';
import { useDiscoverStore } from '@/store/discover';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { type DiscoverSkillDetail as DiscoverSkillDetailType } from '@/types/discover';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    overflow: hidden;

    margin: 0;

    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  divider: css`
    flex-shrink: 0;
    width: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  left: css`
    overflow-y: auto;
    flex-shrink: 0;
    width: 240px;
    padding: 8px;
  `,
  meta: css`
    flex-shrink: 0;
    padding: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  name: css`
    font-size: 16px;
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  right: css`
    container-type: size;
    overflow: auto;
    flex: 1;
  `,
}));

interface MarketSkillDetailProps {
  identifier: string;
}

const buildContentMap = (nodes: SkillResourceTreeNode[]): Record<string, string> => {
  const map: Record<string, string> = {};
  const walk = (items: SkillResourceTreeNode[]) => {
    for (const node of items) {
      if (node.type === 'file' && node.content !== undefined) {
        map[node.path] = node.content;
      } else if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return map;
};

const buildMarketResourceTree = (
  resources?: DiscoverSkillDetailType['resources'],
): { name: string; path: string; type: 'file' }[] => {
  if (!resources) return [];
  return Object.keys(resources)
    .sort()
    .map((path) => ({
      name: path.split('/').pop() || path,
      path,
      type: 'file' as const,
    }));
};

/**
 * Fetch zip from downloadUrl and extract text file contents
 */
const fetchZipContents = async (
  url: string,
): Promise<{ contentMap: Record<string, string>; tree: SkillResourceTreeNode[] }> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error('Skill preview download failed');
  const buf = await readBoundedSkillBody(res.body, SKILL_PACKAGE_MAX_BYTES);

  return new Promise((resolve, reject) => {
    let count = 0;
    let expanded = 0;
    unzip(
      new Uint8Array(buf),
      {
        filter: (entry) => {
          if (
            ++count > SKILL_MAX_ENTRIES ||
            (expanded += entry.originalSize) > SKILL_EXPANDED_MAX_BYTES
          )
            throw new Error('Skill preview exceeds package limits');
          return (
            /(?:SKILL\.md|\.(?:md|txt|json|yaml|yml))$/i.test(entry.name) &&
            entry.originalSize <= 256 * 1024
          );
        },
      },
      (err, files) => {
        if (err) return reject(err);

        const contentMap: Record<string, string> = {};
        const tree: SkillResourceTreeNode[] = [];
        const decoder = new TextDecoder();

        const root = files['SKILL.md']
          ? ''
          : Object.keys(files)
              .find((path) => path.endsWith('/SKILL.md'))
              ?.slice(0, -8) || '';
        for (const [rawPath, data] of Object.entries(files)) {
          if (rawPath.endsWith('/') || rawPath.includes('__MACOSX')) continue;

          // Strip the top-level directory prefix (e.g. "skill-name/")
          const path = root && rawPath.startsWith(root) ? rawPath.slice(root.length) : rawPath;
          if (!path) continue;

          const content = decoder.decode(data);
          contentMap[path] = content;
          if (path === 'SKILL.md') continue;
          tree.push({
            content,
            name: path.split('/').pop() || path,
            path,
            type: 'file',
          });
        }

        tree.sort((a, b) => a.path.localeCompare(b.path));
        resolve({ contentMap, tree });
      },
    );
  });
};

const MarketSkillDetail = memo<MarketSkillDetailProps>(({ identifier }) => {
  const { t } = useTranslation('setting');
  const [selectedFile, setSelectedFile] = useState('SKILL.md');

  // Market data (always fetched for header info + icon)
  const useFetchSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
  const { data, isLoading } = useFetchSkillDetail({ identifier });

  // Installed skill data (for full file content)
  const installedSkill = useToolStore(agentSkillsSelectors.getAgentSkillByIdentifier(identifier));
  const { data: installedData } = useToolStore((s) => s.useFetchAgentSkillDetail)(
    installedSkill?.id,
  );

  // Zip-based content for uninstalled skills
  const [zipContentMap, setZipContentMap] = useState<Record<string, string>>({});
  const [zipTree, setZipTree] = useState<SkillResourceTreeNode[]>([]);
  const [previewError, setPreviewError] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);

  const downloadUrl = marketApiService.getSkillDownloadUrl(identifier);

  useEffect(() => {
    if (installedSkill) return;

    let cancelled = false;
    setPreviewError(false);
    fetchZipContents(downloadUrl)
      .then(({ contentMap, tree }) => {
        if (cancelled) return;
        setZipContentMap(contentMap);
        setZipTree(tree);
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewError(true);
        console.error('[MarketSkillPreview] Download failed', error);
      });
    return () => {
      cancelled = true;
    };
  }, [downloadUrl, installedSkill, previewAttempt]);

  const installedResourceTree = useMemo(
    () => installedData?.resourceTree ?? [],
    [installedData?.resourceTree],
  );
  const installedContentMap = useMemo(
    () => buildContentMap(installedResourceTree),
    [installedResourceTree],
  );

  // Pick the best content source: installed > zip > market metadata
  const contentMap = installedResourceTree.length > 0 ? installedContentMap : zipContentMap;
  const resourceTree = useMemo(() => {
    if (installedResourceTree.length > 0) return installedResourceTree;
    if (zipTree.length > 0) return zipTree;
    return buildMarketResourceTree(data?.resources);
  }, [installedResourceTree, zipTree, data?.resources]);

  if (isLoading || !data) {
    return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 16 }} />;
  }

  const { name, icon, version, description, homepage, github } = data;

  const skillDetailForViewer = {
    content: installedData?.skillDetail?.content || zipContentMap['SKILL.md'] || data.content,
  } as any;

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      <div className={styles.meta}>
        <Flexbox horizontal align={'center'} gap={12}>
          <Avatar avatar={icon || name} shape={'square'} size={40} style={{ flex: 'none' }} />
          <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox horizontal align={'center'} className={styles.description} gap={4}>
                <span className={styles.name}>{name}</span>
                {version && (
                  <>
                    <Icon icon={DotIcon} />
                    <span>v{version}</span>
                  </>
                )}
                <Icon icon={DotIcon} />
                {t('agentSkillDetail.updatedAt')}{' '}
                <PublishedTime date={data.updatedAt} template={'MMM DD, YYYY'} />
              </Flexbox>
              <Flexbox horizontal align={'center'} gap={2} style={{ flexShrink: 0 }}>
                {github?.url && (
                  <a href={github.url} rel="noreferrer" target={'_blank'}>
                    <ActionIcon
                      fill={cssVar.colorTextDescription}
                      icon={Github}
                      title={t('agentSkillDetail.repository')}
                    />
                  </a>
                )}
                {homepage && (
                  <a href={homepage} rel="noreferrer" target={'_blank'}>
                    <ActionIcon icon={ExternalLinkIcon} title={t('agentSkillDetail.sourceUrl')} />
                  </a>
                )}
              </Flexbox>
            </Flexbox>
            {description && <p className={styles.description}>{description}</p>}
          </Flexbox>
        </Flexbox>
      </div>
      {previewError && (
        <Flexbox horizontal align={'center'} gap={8} padding={16}>
          <span>{t('agentSkillDetail.previewFailed')}</span>
          <Button size={'small'} onClick={() => setPreviewAttempt((value) => value + 1)}>
            {t('workspaceSkills.retry')}
          </Button>
        </Flexbox>
      )}
      <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
        <div className={styles.left}>
          <FileTree
            resourceTree={resourceTree}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
        </div>
        <div className={styles.divider} />
        <div className={styles.right} key={selectedFile}>
          <ContentViewer
            contentMap={contentMap}
            selectedFile={selectedFile}
            skillDetail={skillDetailForViewer}
          />
        </div>
      </Flexbox>
    </Flexbox>
  );
});

MarketSkillDetail.displayName = 'MarketSkillDetail';

export default MarketSkillDetail;
