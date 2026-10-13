export type EvidenceState = 'supported' | 'unknown' | 'unsupported';
export type InputModality = 'audio' | 'file' | 'image' | 'text' | 'video';

export type ModelCatalogKind =
  | 'chat'
  | 'embedding'
  | 'image'
  | 'moderation'
  | 'rerank'
  | 'stt'
  | 'tts'
  | 'unknown';

export type ModelKindSource = 'catalog' | 'default' | 'keyword' | 'manual' | 'provider-meta';
export type ContextWindowSource =
  | 'catalog'
  | 'inferred'
  | 'manual'
  | 'observed'
  | 'provider-meta'
  | 'unknown';

export type ModelCapability =
  | 'functionCall'
  | 'reasoning'
  | 'structuredOutput'
  | 'search'
  | 'imageOutput';

export interface ModelCatalogEntry {
  abilitySources: Partial<Record<InputModality, string>>;
  /** Optional on legacy snapshots; maintained descriptions freeze explicit capability evidence. */
  capabilities?: Partial<Record<ModelCapability, EvidenceState>>;
  contextWindowSource: ContextWindowSource;
  contextWindowTokens?: number;
  inputModalities: Record<InputModality, EvidenceState>;
  kind: ModelCatalogKind;
  kindSource: ModelKindSource;
  maxOutput?: number;
  modelId: string;
  /** Exact upstream model revision when the provider exposes one. */
  modelVersion?: string;
  providerId: string;
  verifiedAt?: string;
}

/** Operation-frozen model evidence shared by client/server preflight and runtime. */
export interface ModelCatalogSnapshot {
  capturedAt: string;
  entry: ModelCatalogEntry;
  operationId: string;
  version: 1;
}

/** Redacted evidence emitted only after a structured provider context rejection. */
export interface ContextWindowRejectionObservation {
  contextWindowRejectionTokens: number;
  modelId: string;
  modelVersion?: string;
  providerId: string;
}

export interface InputModalityEvidence {
  modality: InputModality;
  source?: string;
  state: EvidenceState;
  verifiedAt?: string;
}

export type ChatInputModalityConclusion =
  | {
      evidence: NonTextInputModalityEvidence;
      kind: 'supported';
      modalities: NonTextInputModality[];
    }
  | {
      evidence: NonTextInputModalityEvidence;
      kind: 'text-only';
    }
  | {
      evidence: NonTextInputModalityEvidence;
      kind: 'unknown';
      modalities: NonTextInputModality[];
    };

export type NonTextInputModality = Exclude<InputModality, 'text'>;
export type NonTextInputModalityEvidence = Record<NonTextInputModality, InputModalityEvidence>;

/** Chat selection is strict: unknown/non-chat kinds never enter the chat list or default. */
export const isChatEligible = (entry: Pick<ModelCatalogEntry, 'kind'>): boolean =>
  entry.kind === 'chat';

export const filterChatEligibleModels = <T extends Pick<ModelCatalogEntry, 'kind'>>(
  entries: readonly T[],
): T[] => entries.filter(isChatEligible);

export const getInputModalityEvidence = (
  entry: ModelCatalogEntry,
  modality: InputModality,
): InputModalityEvidence => ({
  modality,
  source: entry.abilitySources[modality],
  state: entry.inputModalities[modality],
  verifiedAt: entry.verifiedAt,
});

/** UI projection that keeps unsupported distinct from unknown. */
export const getChatInputModalityConclusion = (
  entry: ModelCatalogEntry,
): ChatInputModalityConclusion => {
  const evidence: NonTextInputModalityEvidence = {
    audio: getInputModalityEvidence(entry, 'audio'),
    file: getInputModalityEvidence(entry, 'file'),
    image: getInputModalityEvidence(entry, 'image'),
    video: getInputModalityEvidence(entry, 'video'),
  };
  const modalities = (Object.keys(evidence) as NonTextInputModality[]).filter(
    (modality) => evidence[modality].state === 'supported',
  );

  if (modalities.length > 0) return { evidence, kind: 'supported', modalities };

  const unknownModalities = (Object.keys(evidence) as NonTextInputModality[]).filter(
    (modality) => evidence[modality].state === 'unknown',
  );
  if (unknownModalities.length > 0) {
    return { evidence, kind: 'unknown', modalities: unknownModalities };
  }

  return { evidence, kind: 'text-only' };
};
