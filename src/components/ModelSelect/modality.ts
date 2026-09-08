import type {
  ChatInputModalityConclusion,
  NonTextInputModality,
} from '@lobechat/types/src/modelCatalog';
import type { EnabledAiModel, ModelAbilities } from 'model-bank';

import { type ChatModelCatalogInput, resolveChatModelCatalog } from '@/helpers/modelCatalog';

export {
  type ChatModelCatalogInput,
  resolveChatModelCatalog,
  type ResolvedChatModelCatalog,
} from '@/helpers/modelCatalog';

/** Display order for the four non-text input modalities. */
export const NON_TEXT_INPUT_MODALITIES: NonTextInputModality[] = [
  'image',
  'audio',
  'video',
  'file',
];

export type EvidenceSourceKind =
  | 'catalog'
  | 'default'
  | 'keyword'
  | 'manual'
  | 'observed'
  | 'provider-meta'
  | 'unknown';

export interface ParsedEvidenceSource {
  detail?: string;
  kind: EvidenceSourceKind;
}

const EVIDENCE_SOURCE_KINDS = new Set<EvidenceSourceKind>([
  'catalog',
  'default',
  'keyword',
  'manual',
  'observed',
  'provider-meta',
  'unknown',
]);

export const findEnabledAiModel = (
  enabledAiModels: readonly EnabledAiModel[] | undefined,
  id: string,
  providerId?: string,
): EnabledAiModel | undefined =>
  enabledAiModels?.find(
    (model) => model.id === id && (!providerId || model.providerId === providerId),
  );

/**
 * Prefer the store's enabled model (which carries `settings.modelCatalog`) over the bare
 * select row, falling back to whatever evidence the row itself carries.
 */
export const toChatModelCatalogInput = (
  row: ChatModelCatalogInput,
  enabledAiModels?: readonly EnabledAiModel[],
): ChatModelCatalogInput => {
  const enabled = findEnabledAiModel(enabledAiModels, row.id, row.providerId);
  if (!enabled) return row;

  return {
    abilities: enabled.abilities ?? row.abilities,
    id: enabled.id,
    providerId: enabled.providerId,
    settings: enabled.settings ?? row.settings,
    type: enabled.type ?? row.type,
  };
};

/**
 * Defensive UI gate: keep only rows that B1 classifies as chat-eligible. This consumes the
 * B1 catalog helpers directly and adds no model id denylist of its own.
 */
export const filterChatEligibleProviderModels = <
  T extends { children: Array<{ abilities?: ModelAbilities; id: string }>; id: string },
>(
  providers: readonly T[],
  enabledAiModels?: readonly EnabledAiModel[],
): T[] =>
  providers.map((provider) => ({
    ...provider,
    children: provider.children.filter(
      (model) =>
        resolveChatModelCatalog(
          toChatModelCatalogInput(
            { abilities: model.abilities, id: model.id, providerId: provider.id },
            enabledAiModels,
          ),
        ).chatEligible,
    ),
  }));

/** Split a B1 ability source such as `manual:owner` or `provider-meta:supported_modalities`. */
export const parseEvidenceSource = (source?: string): ParsedEvidenceSource => {
  if (!source) return { kind: 'unknown' };

  const separator = source.indexOf(':');
  const head = separator === -1 ? source : source.slice(0, separator);
  const detail = separator === -1 ? undefined : source.slice(separator + 1) || undefined;

  if (EVIDENCE_SOURCE_KINDS.has(head as EvidenceSourceKind)) {
    return { detail, kind: head as EvidenceSourceKind };
  }

  return { detail: source, kind: 'unknown' };
};

/** Supported modalities in stable display order. */
export const sortNonTextModalities = (
  modalities: readonly NonTextInputModality[],
): NonTextInputModality[] =>
  [...modalities].sort(
    (a, b) => NON_TEXT_INPUT_MODALITIES.indexOf(a) - NON_TEXT_INPUT_MODALITIES.indexOf(b),
  );

/** All four non-text evidences share the entry-level `verifiedAt`; surface it once. */
export const getConclusionVerifiedAt = (conclusion: ChatInputModalityConclusion) =>
  NON_TEXT_INPUT_MODALITIES.map((modality) => conclusion.evidence[modality].verifiedAt).find(
    Boolean,
  );
