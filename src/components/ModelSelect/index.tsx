import { type ChatModelCard, ManagedModelDescriptionSchema } from '@lobechat/types';
import {
  type ChatInputModalityConclusion,
  type EvidenceState,
} from '@lobechat/types/src/modelCatalog';
import { type IconAvatarProps } from '@lobehub/icons';
import { LobeHub, ModelIcon, ProviderIcon } from '@lobehub/icons';
import { type FlexboxProps } from '@lobehub/ui';
import { Avatar, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import {
  Infinity as InfinityIcon,
  LucideEye,
  LucideImage,
  LucidePaperclip,
  Type,
  Video,
  Wrench,
} from 'lucide-react';
import { type ModelAbilities } from 'model-bank';
import numeral from 'numeral';
import { type CSSProperties, type FC } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';
import { type AiProviderSourceType } from '@/types/aiProvider';
import { formatTokenNumber } from '@/utils/format';

import { useChatModelCatalog } from './hooks';
import { InputModalityTags } from './InputModalityTags';
import NewModelBadgeI18n, { NewModelBadge as NewModelBadgeCore } from './NewModelBadge';

export const TAG_CLASSNAME = 'lobe-model-info-tags';

const styles = createStaticStyles(({ css, cssVar }) => ({
  tag: css`
    cursor: default;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px !important;
    height: 20px;
    border-radius: 4px;
  `,
  token: css`
    width: 36px !important;
    height: 20px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

type TooltipStyles = typeof styles;

interface ModelInfoTagsProps extends ModelAbilities {
  contextWindowTokens?: number | null;
  directionReverse?: boolean;
  disableTooltip?: boolean;
  /**
   * Evidence-backed input modality conclusion from the B1 catalog. When present it
   * replaces the legacy vision/file/video ability tags, which then derive from the
   * same `inputModalities` evidence instead of raw ability booleans.
   */
  inputModality?: ChatInputModalityConclusion;
  isCustom?: boolean;
  managedImageState?: EvidenceState;
  placement?: 'top' | 'right';
  /**
   * Whether to render the non-modality ability tags (tool calling, image output) and
   * the context window tag. Compact chat rows keep only the modality conclusion.
   */
  showAbilityTags?: boolean;
  style?: CSSProperties;
  visualOnly?: boolean;
}

interface FeatureTagsProps extends Pick<
  ModelAbilities,
  'files' | 'imageOutput' | 'vision' | 'video' | 'functionCall'
> {
  disableTooltip?: boolean;
  placement: 'top' | 'right';
  tagClassName: string;
}

interface FeatureTagItemProps {
  className: string;
  color: Parameters<typeof Tag>[0]['color'];
  disableTooltip?: boolean;
  enabled: boolean | undefined;
  icon: Parameters<typeof Icon>[0]['icon'];
  placement: 'top' | 'right';
  title: string;
}

const FeatureTagItem = memo<FeatureTagItemProps>(
  ({ className, color, disableTooltip, enabled, icon, placement, title }) => {
    if (!enabled) return null;

    const tag = (
      <Tag className={className} color={color} size={'small'}>
        <Icon icon={icon} />
      </Tag>
    );

    if (disableTooltip) return tag;

    return (
      <Tooltip placement={placement} title={title}>
        {tag}
      </Tooltip>
    );
  },
);

const FeatureTags = memo<FeatureTagsProps>(
  ({
    disableTooltip,
    files,
    functionCall,
    imageOutput,
    placement,
    tagClassName,
    video,
    vision,
  }) => {
    const { t } = useTranslation('components');

    return (
      <>
        <FeatureTagItem
          className={tagClassName}
          color={'success'}
          disableTooltip={disableTooltip}
          enabled={files}
          icon={LucidePaperclip}
          placement={placement}
          title={t('ModelSelect.featureTag.file')}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'success'}
          disableTooltip={disableTooltip}
          enabled={imageOutput}
          icon={LucideImage}
          placement={placement}
          title={t('ModelSelect.featureTag.imageOutput')}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'success'}
          disableTooltip={disableTooltip}
          enabled={vision}
          icon={LucideEye}
          placement={placement}
          title={t('ModelSelect.featureTag.vision')}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'magenta'}
          disableTooltip={disableTooltip}
          enabled={video}
          icon={Video}
          placement={placement}
          title={t('ModelSelect.featureTag.video')}
        />
        <FeatureTagItem
          className={tagClassName}
          color={'info'}
          disableTooltip={disableTooltip}
          enabled={functionCall}
          icon={Wrench}
          placement={placement}
          title={t('ModelSelect.featureTag.functionCall')}
        />
      </>
    );
  },
);

const Context = memo(
  ({
    contextWindowTokens,
    disableTooltip,
    placement,
    styles,
  }: {
    contextWindowTokens: number;
    disableTooltip?: boolean;
    placement: 'top' | 'right';
    styles: TooltipStyles;
  }) => {
    const { t } = useTranslation('components');
    const tokensText = contextWindowTokens === 0 ? '∞' : formatTokenNumber(contextWindowTokens);

    const tag = (
      <Tag className={styles.token} size={'small'}>
        {contextWindowTokens === 0 ? <InfinityIcon size={17} strokeWidth={1.6} /> : tokensText}
      </Tag>
    );

    if (disableTooltip) return tag;

    return (
      <Tooltip
        placement={placement}
        title={t('ModelSelect.featureTag.tokens', {
          tokens: contextWindowTokens === 0 ? '∞' : numeral(contextWindowTokens).format('0,0'),
        })}
      >
        {tag}
      </Tooltip>
    );
  },
);

export const ModelInfoTags = memo<ModelInfoTagsProps>(
  ({
    directionReverse,
    disableTooltip,
    inputModality,
    managedImageState,
    visualOnly,
    placement = 'top',
    showAbilityTags = true,
    style,
    ...model
  }) => {
    const { t } = useTranslation('components');
    // With catalog evidence in hand, image/audio/video/file come from `inputModalities`;
    // the raw ability booleans only back the legacy path for callers without evidence.
    const hasEvidence = !!inputModality;

    return (
      <Flexbox
        className={TAG_CLASSNAME}
        direction={directionReverse ? 'horizontal-reverse' : 'horizontal'}
        gap={2}
        style={{ marginLeft: 'auto', ...style }}
        width={'fit-content'}
      >
        {inputModality && (
          <InputModalityTags
            conclusion={inputModality}
            disableTooltip={disableTooltip}
            placement={placement}
            tagClassName={styles.tag}
            visualOnly={visualOnly}
          />
        )}
        {managedImageState && managedImageState !== 'unknown' && (
          <Tag
            className={styles.tag}
            color={managedImageState === 'supported' ? 'success' : undefined}
            role="img"
            size="small"
            variant={managedImageState === 'unsupported' ? 'outlined' : undefined}
            aria-label={`${t('ModelSwitchPanel.detail.managed.imageInput')}：${t(
              `ModelSwitchPanel.detail.managed.${managedImageState}`,
            )}`}
          >
            <Icon icon={managedImageState === 'supported' ? LucideEye : Type} />
          </Tag>
        )}
        {showAbilityTags && (
          <FeatureTags
            disableTooltip={disableTooltip}
            files={hasEvidence ? undefined : model.files}
            functionCall={model.functionCall}
            imageOutput={model.imageOutput}
            placement={placement}
            tagClassName={styles.tag}
            video={hasEvidence ? undefined : model.video}
            vision={hasEvidence ? undefined : model.vision}
          />
        )}
        {showAbilityTags && typeof model.contextWindowTokens === 'number' && (
          <Context
            contextWindowTokens={model.contextWindowTokens}
            disableTooltip={disableTooltip}
            placement={placement}
            styles={styles}
          />
        )}
      </Flexbox>
    );
  },
);

interface ModelItemRenderProps extends ChatModelCard, Partial<Omit<FlexboxProps, 'id' | 'title'>> {
  abilities?: ModelAbilities;
  disableTooltip?: boolean;
  newBadgeLabel?: string;
  proBadgeLabel?: string;
  /** Provider owning this row, so the catalog lookup matches the exact provider/model pair. */
  providerId?: string;
  showInfoTag?: boolean;
  /**
   * Render the B1 input modality conclusion for chat rows. Independent of `showInfoTag`
   * and developer mode: a chat row always states supported / text-only / unverified.
   */
  showInputModality?: boolean;
  /** The switch panel already provides a shared detail popup. */
  visualOnly?: boolean;
}

export const ModelItemRender = memo<ModelItemRenderProps>(
  ({
    showInfoTag = true,
    visualOnly,
    disableTooltip,
    abilities,
    className,
    contextWindowTokens,
    files,
    functionCall,
    imageOutput,
    newBadgeLabel,
    proBadgeLabel,
    providerId,
    reasoning,
    search,
    settings,
    showInputModality = true,
    type,
    video,
    vision,
    id,
    displayName,
    releasedAt,
    style,
  }) => {
    const { mobile } = useResponsive();
    const displayNameOrId = displayName || id;
    const rowAbilities = useMemo<ModelAbilities>(
      () => abilities ?? { files, functionCall, imageOutput, reasoning, search, video, vision },
      [abilities, files, functionCall, imageOutput, reasoning, search, video, vision],
    );
    const catalog = useChatModelCatalog({
      abilities: rowAbilities,
      id,
      providerId,
      settings,
      type,
    });
    const managedDescription = useAiInfraStore((state) =>
      providerId === 'newapi'
        ? state.enabledAiModels?.find((model) => model.id === id && model.providerId === providerId)
            ?.settings?.managedModelCatalog?.description
        : undefined,
    );
    const parsedDescription = ManagedModelDescriptionSchema.safeParse(managedDescription);
    const managedImageState = parsedDescription.success
      ? parsedDescription.data.inputModalities.image
      : undefined;
    const hasManagedImageState =
      showInputModality &&
      (managedImageState === 'supported' || managedImageState === 'unsupported');
    const inputModality =
      showInputModality && catalog.chatEligible && !hasManagedImageState
        ? catalog.inputModality
        : undefined;

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={className}
        gap={32}
        justify={'space-between'}
        style={{
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
          ...style,
        }}
      >
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}
        >
          <ModelIcon model={id} size={20} />
          <Text
            style={mobile ? { maxWidth: '60vw' } : { minWidth: 0, overflow: 'hidden' }}
            ellipsis={{
              tooltip: displayNameOrId,
              tooltipWhenOverflow: true,
            }}
          >
            {displayNameOrId}
          </Text>
          {newBadgeLabel ? (
            <NewModelBadgeCore label={newBadgeLabel} releasedAt={releasedAt} />
          ) : (
            <NewModelBadgeI18n releasedAt={releasedAt} />
          )}
          {proBadgeLabel && (
            <Tag color="gold" size="small">
              {proBadgeLabel}
            </Tag>
          )}
        </Flexbox>
        {(showInfoTag || inputModality || hasManagedImageState) && (
          <ModelInfoTags
            contextWindowTokens={contextWindowTokens}
            disableTooltip={disableTooltip}
            files={files ?? abilities?.files}
            functionCall={functionCall ?? abilities?.functionCall}
            imageOutput={imageOutput ?? abilities?.imageOutput}
            inputModality={inputModality}
            managedImageState={hasManagedImageState ? managedImageState : undefined}
            showAbilityTags={showInfoTag}
            style={{ zoom: 0.9 }}
            video={video ?? abilities?.video}
            vision={hasManagedImageState ? undefined : (vision ?? abilities?.vision)}
            visualOnly={visualOnly}
          />
        )}
      </Flexbox>
    );
  },
);

interface ProviderItemRenderProps {
  logo?: string;
  name: string;
  provider: string;
  size?: number;
  source?: AiProviderSourceType;
  type?: 'mono' | 'color' | 'avatar';
}

export const ProviderItemRender = memo<ProviderItemRenderProps>(
  ({ provider, name, source, logo, type = 'mono', size = 16 }) => {
    const isMono = type === 'mono';
    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={6}
        width={'100%'}
        style={{
          overflow: 'hidden',
        }}
      >
        {source === 'custom' && !!logo ? (
          <Avatar
            avatar={logo}
            shape={'circle'}
            size={size}
            style={isMono ? { filter: 'grayscale(1)' } : {}}
            title={name}
          />
        ) : provider === 'lobehub' ? (
          <LobeHub.Morden size={size} />
        ) : (
          <ProviderIcon provider={provider} size={size} type={type} />
        )}
        <Text ellipsis color={'inherit'}>
          {name}
        </Text>
      </Flexbox>
    );
  },
);

interface LabelRendererProps {
  Icon: FC<IconAvatarProps>;
  label: string;
}

export const LabelRenderer = memo<LabelRendererProps>(({ Icon, label }) => (
  <Flexbox horizontal align={'center'} gap={8}>
    <Icon size={20} />
    <span>{label}</span>
  </Flexbox>
));

export { useChatEligibleModelList, useChatModelCatalog } from './hooks';
export { InputModalityTags, MODALITY_ICONS, useInputModalityLabels } from './InputModalityTags';
export {
  type ChatModelCatalogInput,
  filterChatEligibleProviderModels,
  getConclusionVerifiedAt,
  NON_TEXT_INPUT_MODALITIES,
  parseEvidenceSource,
  resolveChatModelCatalog,
  type ResolvedChatModelCatalog,
  sortNonTextModalities,
} from './modality';
