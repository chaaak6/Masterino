import type {
  ChatInputModalityConclusion,
  EvidenceState,
  InputModalityEvidence,
  NonTextInputModality,
} from '@lobechat/types/src/modelCatalog';
import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { Tooltip } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import dayjs from 'dayjs';
import type { LucideIcon } from 'lucide-react';
import {
  AudioLines,
  CircleQuestionMark,
  LucideEye,
  LucidePaperclip,
  Type,
  Video,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type EvidenceSourceKind,
  getConclusionVerifiedAt,
  NON_TEXT_INPUT_MODALITIES,
  parseEvidenceSource,
  sortNonTextModalities,
} from './modality';

const styles = createStaticStyles(({ css, cssVar }) => ({
  tag: css`
    cursor: default;

    display: flex;
    align-items: center;
    justify-content: center;

    border-radius: 4px;
  `,
  tooltip: css`
    font-size: 12px;
    line-height: 1.5;
  `,
  unverified: css`
    border: 1px dashed ${cssVar.colorBorder} !important;
    color: ${cssVar.colorTextTertiary} !important;
    background: transparent !important;
  `,
}));

type ModalityTagPlacement = 'top' | 'right';

export const MODALITY_ICONS: Record<NonTextInputModality, LucideIcon> = {
  audio: AudioLines,
  file: LucidePaperclip,
  image: LucideEye,
  video: Video,
};

const MODALITY_TAG_COLORS: Record<NonTextInputModality, 'magenta' | 'success'> = {
  audio: 'success',
  file: 'success',
  image: 'success',
  video: 'magenta',
};

const DEFAULT_MODALITY_NAMES: Record<NonTextInputModality, string> = {
  audio: 'Audio input',
  file: 'File input',
  image: 'Image input',
  video: 'Video input',
};

const DEFAULT_SUPPORTED_LABELS: Record<NonTextInputModality, string> = {
  audio: 'Supports audio input',
  file: 'Supports file input',
  image: 'Supports image input',
  video: 'Supports video input',
};

const DEFAULT_STATE_LABELS: Record<EvidenceState, string> = {
  supported: 'Supported',
  unknown: 'Unverified',
  unsupported: 'Unsupported',
};

const SOURCE_KIND_KEYS: Record<EvidenceSourceKind, string> = {
  'catalog': 'catalog',
  'default': 'default',
  'keyword': 'keyword',
  'manual': 'manual',
  'observed': 'observed',
  'provider-meta': 'providerMeta',
  'unknown': 'unknown',
};

const DEFAULT_SOURCE_LABELS: Record<EvidenceSourceKind, string> = {
  'catalog': 'Model catalog',
  'default': 'Default assumption',
  'keyword': 'Model id keyword',
  'manual': 'Manual override',
  'observed': 'Observed request',
  'provider-meta': 'Provider metadata',
  'unknown': 'No evidence',
};

/**
 * Shared label builders so list rows, tooltips and the detail panel describe the same
 * conclusion with the same words. English defaults keep the UI readable before the
 * default locale source picks up the new keys.
 */
export const useInputModalityLabels = () => {
  const { t } = useTranslation('components');

  return useMemo(() => {
    const tr = (key: string, defaultValue: string, options?: Record<string, unknown>) =>
      String(t(key as any, { ...options, defaultValue }));
    const separator = tr('ModelSelect.inputModality.separator', ', ');

    const modalityName = (modality: NonTextInputModality) =>
      tr(`ModelSelect.inputModality.${modality}`, DEFAULT_MODALITY_NAMES[modality]);
    const stateLabel = (state: EvidenceState) =>
      tr(`ModelSelect.inputModality.state.${state}`, DEFAULT_STATE_LABELS[state]);
    const sourceLabel = (source?: string) => {
      const parsed = parseEvidenceSource(source);
      const label = tr(
        `ModelSelect.inputModality.sourceKind.${SOURCE_KIND_KEYS[parsed.kind]}`,
        DEFAULT_SOURCE_LABELS[parsed.kind],
      );

      return parsed.detail ? `${label} (${parsed.detail})` : label;
    };
    const verifiedLabel = (verifiedAt?: string) => {
      const date = verifiedAt ? dayjs(verifiedAt) : undefined;

      return date?.isValid()
        ? tr('ModelSelect.inputModality.verifiedAt', 'Verified {{date}}', {
            date: date.format('YYYY-MM-DD'),
          })
        : tr('ModelSelect.inputModality.notVerified', 'Not verified yet');
    };
    const modalityList = (modalities: readonly NonTextInputModality[]) =>
      sortNonTextModalities(modalities).map(modalityName).join(separator);

    const textOnly = tr('ModelSelect.inputModality.textOnly', 'Text only');
    const unverified = tr('ModelSelect.inputModality.unverified', 'Unverified');

    return {
      conclusionLabel: (conclusion: ChatInputModalityConclusion) => {
        if (conclusion.kind === 'supported') return modalityList(conclusion.modalities);
        if (conclusion.kind === 'text-only') return textOnly;

        return unverified;
      },
      evidenceLine: (evidence: InputModalityEvidence) =>
        `${modalityName(evidence.modality as NonTextInputModality)}: ${stateLabel(
          evidence.state,
        )} · ${tr('ModelSelect.inputModality.source', 'Source: {{source}}', {
          source: sourceLabel(evidence.source),
        })}`,
      modalityName,
      sourceLabel,
      stateLabel,
      supportedLabel: (modality: NonTextInputModality) =>
        tr(`ModelSelect.inputModality.supported.${modality}`, DEFAULT_SUPPORTED_LABELS[modality]),
      textOnly,
      textOnlyDesc: tr(
        'ModelSelect.inputModality.textOnlyDesc',
        'Only text input is supported. Image, audio, video and file input are unsupported.',
      ),
      unverified,
      unverifiedDesc: (modalities: readonly NonTextInputModality[]) =>
        tr(
          'ModelSelect.inputModality.unverifiedDesc',
          'Input modality evidence is incomplete. Not yet verified: {{modalities}}.',
          { modalities: modalityList(modalities) },
        ),
      verifiedLabel,
    };
  }, [t]);
};

interface EvidenceTooltipProps {
  headline: string;
  lines: string[];
  verified: string;
}

const EvidenceTooltip = memo<EvidenceTooltipProps>(({ headline, lines, verified }) => (
  <Flexbox className={styles.tooltip} gap={2}>
    <span>{headline}</span>
    {lines.map((line) => (
      <span key={line}>{line}</span>
    ))}
    <span>{verified}</span>
  </Flexbox>
));

interface ModalityTagProps {
  ariaLabel: string;
  className?: string;
  color?: 'magenta' | 'success';
  disableTooltip?: boolean;
  icon: LucideIcon;
  kind: ChatInputModalityConclusion['kind'];
  placement: ModalityTagPlacement;
  tooltip: ReactNode;
  variant?: 'filled' | 'outlined';
}

const ModalityTag = memo<ModalityTagProps>(
  ({ ariaLabel, className, color, disableTooltip, icon, kind, placement, tooltip, variant }) => {
    const tag = (
      <Tag
        aria-label={ariaLabel}
        className={cx(styles.tag, className)}
        color={color}
        data-input-modality={kind}
        role={'img'}
        size={'small'}
        variant={variant}
      >
        <Icon icon={icon} />
      </Tag>
    );

    if (disableTooltip) return tag;

    return (
      <Tooltip placement={placement} title={tooltip}>
        {tag}
      </Tooltip>
    );
  },
);

export interface InputModalityTagsProps {
  conclusion: ChatInputModalityConclusion;
  disableTooltip?: boolean;
  placement?: ModalityTagPlacement;
  tagClassName?: string;
  /** Show only supported image/video icons; omit unknown and text-only markers. */
  visualOnly?: boolean;
}

/**
 * Always renders exactly one input-modality conclusion for a chat model row:
 * one icon per supported modality, a neutral `Text only` marker, or a dashed
 * `Unverified` marker. Every tag carries a screen-reader label and a tooltip
 * listing the evidence source and verification time.
 */
export const InputModalityTags = memo<InputModalityTagsProps>(
  ({ conclusion, disableTooltip, placement = 'top', tagClassName, visualOnly = false }) => {
    const labels = useInputModalityLabels();
    const verified = labels.verifiedLabel(getConclusionVerifiedAt(conclusion));
    const allLines = NON_TEXT_INPUT_MODALITIES.map((modality) =>
      labels.evidenceLine(conclusion.evidence[modality]),
    );

    if (conclusion.kind === 'supported') {
      return (
        <>
          {sortNonTextModalities(conclusion.modalities)
            .filter((modality) => !visualOnly || modality === 'image' || modality === 'video')
            .map((modality) => (
              <ModalityTag
                ariaLabel={labels.supportedLabel(modality)}
                className={tagClassName}
                color={MODALITY_TAG_COLORS[modality]}
                disableTooltip={disableTooltip}
                icon={MODALITY_ICONS[modality]}
                key={modality}
                kind={'supported'}
                placement={placement}
                tooltip={
                  <EvidenceTooltip
                    headline={labels.supportedLabel(modality)}
                    lines={[labels.evidenceLine(conclusion.evidence[modality])]}
                    verified={verified}
                  />
                }
              />
            ))}
        </>
      );
    }

    if (visualOnly) return null;

    if (conclusion.kind === 'text-only') {
      return (
        <ModalityTag
          ariaLabel={labels.textOnly}
          className={tagClassName}
          disableTooltip={disableTooltip}
          icon={Type}
          kind={'text-only'}
          placement={placement}
          variant={'outlined'}
          tooltip={
            <EvidenceTooltip headline={labels.textOnlyDesc} lines={allLines} verified={verified} />
          }
        />
      );
    }

    return (
      <ModalityTag
        ariaLabel={labels.unverified}
        className={cx(tagClassName, styles.unverified)}
        disableTooltip={disableTooltip}
        icon={CircleQuestionMark}
        kind={'unknown'}
        placement={placement}
        variant={'outlined'}
        tooltip={
          <EvidenceTooltip
            headline={labels.unverifiedDesc(conclusion.modalities)}
            lines={allLines}
            verified={verified}
          />
        }
      />
    );
  },
);

InputModalityTags.displayName = 'InputModalityTags';
