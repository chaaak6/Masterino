import { supportsEmbeddingDimension } from '@lobechat/business-model-bank';
import { DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS } from '@lobechat/const';
import { TooltipGroup } from '@lobehub/ui';
import { Select, type SelectProps } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ModelItemRender,
  ProviderItemRender,
  TAG_CLASSNAME,
  useChatEligibleModelList,
} from '@/components/ModelSelect';
import { useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  popup: css`
    width: max(360px, var(--anchor-width));

    &.${prefixCls}-select-dropdown .${prefixCls}-select-item-option-grouped {
      padding-inline-start: 12px;
    }
  `,
  select: css`
    .${prefixCls}-select-selection-item {
      .${TAG_CLASSNAME} {
        display: none;
      }
    }
  `,
}));

interface ModelOption {
  abilities?: Record<string, boolean>;
  id: string;
  label: ReactNode;
  provider: string;
  value: string;
}

interface ModelSelectProps extends Pick<
  SelectProps,
  'disabled' | 'loading' | 'size' | 'style' | 'variant'
> {
  defaultValue?: { model: string; provider?: string };
  initialWidth?: boolean;
  modelType?: 'chat' | 'embedding';
  onChange?: (props: { model: string; provider: string }) => void;
  popupWidth?: number;
  requiredAbilities?: (keyof EnabledProviderWithModels['children'][number]['abilities'])[];
  showAbility?: boolean;
  value?: { model: string; provider?: string };
}

const ModelSelect = memo<ModelSelectProps>(
  ({
    value,
    onChange,
    showAbility = true,
    modelType = 'chat',
    requiredAbilities,
    loading,
    disabled,
    size,
    style,
    variant,
    initialWidth = false,
    popupWidth,
  }) => {
    // Only B1 chat-eligible rows reach the dropdown; no local id denylist.
    const chatModels = useChatEligibleModelList();
    const enabledAiModels = useAiInfraStore((s) => s.enabledAiModels);
    const enabledAiProviders = useAiInfraStore((s) => s.enabledAiProviders);
    const embeddingModels = useMemo<EnabledProviderWithModels[]>(
      () =>
        (enabledAiProviders ?? []).flatMap((provider) => {
          const children = (enabledAiModels ?? []).filter(
            (model) =>
              model.providerId === provider.id &&
              model.type === 'embedding' &&
              supportsEmbeddingDimension(model.id, DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS) &&
              model.enabled !== false &&
              model.visible !== false,
          );
          return children.length
            ? [{ ...provider, children, name: provider.name || provider.id }]
            : [];
        }),
      [enabledAiModels, enabledAiProviders],
    );
    const enabledList = modelType === 'embedding' ? embeddingModels : chatModels;
    const { t } = useTranslation('components');
    const catalog = useAiInfraStore((s) => s.silentModelCatalog);
    const selectedProvider = value?.provider;
    const selectedValue = value?.provider && value.model ? `${value.provider}/${value.model}` : null;
    const unavailable =
      modelType === 'chat' &&
      catalog &&
      selectedProvider === 'newapi' &&
      value?.model &&
      !catalog.models.some((model) => model.id === value.model && model.type === 'chat');

    const options = useMemo<SelectProps['options']>(() => {
      const getChatModels = (provider: EnabledProviderWithModels) => {
        const models =
          requiredAbilities && requiredAbilities.length > 0
            ? provider.children.filter((model) =>
                requiredAbilities.every((ability) => Boolean(model.abilities?.[ability])),
              )
            : provider.children;

        return models.map((model) => ({
          ...model,
          label: (
            <ModelItemRender
              {...model}
              {...model.abilities}
              providerId={provider.id}
              showInfoTag={false}
              showInputModality={showAbility}
            />
          ),
          provider: provider.id,
          value: `${provider.id}/${model.id}`,
        }));
      };

      if (enabledList.length === 1) {
        const provider = enabledList[0];

        return getChatModels(provider);
      }

      return enabledList
        .map((provider) => {
          const opts = getChatModels(provider);
          if (opts.length === 0) return undefined;

          return {
            label: (
              <ProviderItemRender
                logo={provider.logo}
                name={provider.name}
                provider={provider.id}
                source={provider.source}
              />
            ),
            options: opts,
          };
        })
        .filter(Boolean) as SelectProps['options'];
    }, [enabledList, requiredAbilities, showAbility]);

    const visibleOptions = unavailable
      ? [
          {
            value: selectedValue,
            id: value!.model,
            provider: selectedProvider!,
            disabled: true,
            label: `${value!.model} · ${t('ModelSwitchPanel.detail.managed.unavailable')}`,
          },
          ...(options ?? []),
        ]
      : options;

    return (
      <TooltipGroup>
        <Select
          className={styles.select}
          defaultValue={selectedValue}
          disabled={disabled}
          loading={loading}
          options={visibleOptions}
          popupClassName={styles.popup}
          popupMatchSelectWidth={popupWidth === undefined ? false : popupWidth}
          size={size}
          value={selectedValue}
          variant={variant}
          optionRender={(option) => {
            // base-ui Select adds a minimal { label, value } option for a saved
            // value missing from the available model list. It has no model id.
            const modelOption = option as Partial<ModelOption>;
            if (option.disabled || !modelOption.id || !modelOption.provider) return option.label;

            return (
              <ModelItemRender
                {...(modelOption as ModelOption)}
                {...modelOption.abilities}
                providerId={modelOption.provider}
                showInfoTag={false}
                showInputModality={showAbility}
              />
            );
          }}
          style={{
            minWidth: 200,
            width: initialWidth ? 'initial' : undefined,
            ...style,
          }}
          onChange={(nextValue, option) => {
            const modelOption = option as Partial<ModelOption> | undefined;
            // Do not persist Select's synthetic option for an unavailable model.
            if (typeof nextValue !== 'string' || !modelOption?.id || !modelOption.provider) return;
            onChange?.({ model: modelOption.id, provider: modelOption.provider });
          }}
        />
      </TooltipGroup>
    );
  },
);

export default ModelSelect;
