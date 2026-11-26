'use client';

import { Icon, Tag, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';

import DirIcon from './DirIcon';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    cursor: default;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border: none;
    border-radius: 4px;

    font: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  label: css`
    display: inline-flex;
    max-width: 140px;
    white-space: nowrap;
  `,
  pathStart: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
  `,
  pathEnd: css`
    overflow: hidden;
    display: flex;
    justify-content: flex-end;
    min-width: 0;
  `,
  lock: css`
    color: ${cssVar.colorTextQuaternary};
  `,
}));

const pathSegmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;

export interface WorkspaceChipProps {
  effective: EffectiveWorkspace;
  repoType?: 'git' | 'github';
}

/**
 * Read-only chip for project-bound and scratch topics. The primary cwd cannot
 * be changed in place; users start another topic from the sidebar instead.
 */
const WorkspaceChip = memo<WorkspaceChipProps>(({ effective, repoType }) => {
  const { t } = useTranslation('chat');
  const tw = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const cwd = effective.cwd ?? effective.workspace?.rootPath ?? '';
  const pathCharacters = pathSegmenter
    ? Array.from(pathSegmenter.segment(cwd), ({ segment }) => segment)
    : Array.from(cwd);
  const midpoint = Math.ceil(pathCharacters.length / 2);
  const isScratch = effective.state === 'scratch';

  const tooltip = isScratch
    ? tw('workspaceRuntime.chip.scratchTooltip', { path: cwd })
    : tw('workspaceRuntime.chip.boundTooltip', { path: cwd });

  const contents = (
    <>
      <DirIcon repoType={repoType} />
      <span aria-hidden className={styles.label}>
        <span className={styles.pathStart}>{pathCharacters.slice(0, midpoint).join('')}</span>
        <span className={styles.pathEnd}>{pathCharacters.slice(midpoint).join('')}</span>
      </span>
      {isScratch && (
        <Tag data-testid="workspace-chip-scratch" size={'small'}>
          {tw('workspaceRuntime.chip.scratch')}
        </Tag>
      )}
      <Icon className={styles.lock} icon={LockIcon} size={11} />
    </>
  );

  return (
    <Tooltip title={tooltip}>
      <span
        aria-label={tooltip}
        className={styles.chip}
        data-testid="workspace-chip"
        data-workspace-state={effective.state}
      >
        {contents}
      </span>
    </Tooltip>
  );
});

WorkspaceChip.displayName = 'WorkspaceChip';

export default WorkspaceChip;
