import type {
  ContextWindowSource,
  EvidenceState,
  InputModality,
  ModelCatalogEntry,
  ModelCatalogKind,
  ModelCatalogSnapshot,
  ModelKindSource,
} from '@lobechat/types/src/modelCatalog';
import type { AiModelType, ModelAbilities } from 'model-bank';

const INPUT_MODALITIES: InputModality[] = ['text', 'image', 'audio', 'video', 'file'];
const EVIDENCE_STATES = new Set<EvidenceState>(['supported', 'unknown', 'unsupported']);
const MODEL_CATALOG_KINDS = new Set<ModelCatalogKind>([
  'chat',
  'embedding',
  'image',
  'moderation',
  'rerank',
  'stt',
  'tts',
  'unknown',
]);
const OBSERVED_EVIDENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const RERANK_KEYWORDS = ['rerank', 'reranker'] as const;
const EMBEDDING_KEYWORDS = ['embedding', 'embed', 'bge', 'm3e'] as const;
const IMAGE_KEYWORDS = [
  'dall-e',
  'dalle',
  'midjourney',
  'stable-diffusion',
  'flux',
  'imagen',
  'firefly',
  'cogview',
  'wanxiang',
  '-image',
] as const;

export interface ModelCatalogDrift {
  conflictingSource: string;
  conflictingValue: EvidenceState | ModelCatalogKind | number;
  field: `inputModalities.${InputModality}` | 'contextWindowTokens' | 'kind';
  selectedSource: string;
  selectedValue: EvidenceState | ModelCatalogKind | number;
}

export interface ModelCatalogManualOverride {
  allowChat?: boolean;
  contextWindowTokens?: number;
  createdAt: string;
  denyChat?: boolean;
  expiresAt?: string;
  forceContextWindow?: boolean;
  inputModalities?: Partial<Record<InputModality, EvidenceState>>;
  kind?: ModelCatalogKind;
  maxOutput?: number;
  owner: string;
  reason: string;
}

export interface ModelCatalogObservedEvidence {
  contextWindowRejectionTokens?: number;
  inputModalities?: Partial<Record<InputModality, EvidenceState>>;
  modelVersion?: string;
  verifiedAt: string;
}

export interface ModelCatalogProviderMetadata {
  contextWindowTokens?: number;
  declaredKind?: string;
  endpointTypes?: readonly string[];
  inputModalities?: Partial<Record<InputModality, EvidenceState>>;
  maxOutput?: number;
  modelVersion?: string;
  supportedInputModalities?: readonly string[];
  unsupportedInputModalities?: readonly string[];
  verifiedAt?: string;
}

export interface ModelCatalogFallback {
  abilities?: ModelAbilities;
  contextWindowTokens?: number;
  inputModalities?: Partial<Record<InputModality, EvidenceState>>;
  kind?: string;
  maxOutput?: number;
}

export interface ModelCatalogMergeInput {
  catalog?: ModelCatalogFallback;
  inferredContextWindowTokens?: number;
  manual?: ModelCatalogManualOverride;
  modelId: string;
  now?: Date | string;
  observed?: ModelCatalogObservedEvidence;
  providerId: string;
  providerMetadata?: ModelCatalogProviderMetadata;
}

interface ContextWindowCandidate {
  source: Exclude<ContextWindowSource, 'observed'>;
  tokens: number;
  verifiedAt?: string;
}

export interface PersistedModelCatalog {
  contextWindowCandidate?: ContextWindowCandidate;
  denied: boolean;
  drift: ModelCatalogDrift[];
  entry: ModelCatalogEntry;
  manual?: ModelCatalogManualOverride;
  observed?: ModelCatalogObservedEvidence;
  version: 1;
}

export interface ContextWindowRejectionEvidenceInput {
  contextWindowRejectionTokens: number;
  modelVersion?: string;
  verifiedAt: string;
}

interface KindEvidence {
  kind: ModelCatalogKind;
  source: ModelKindSource;
}

interface ModalityCandidate {
  source: string;
  state: EvidenceState;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isEvidenceState = (value: unknown): value is EvidenceState =>
  typeof value === 'string' && EVIDENCE_STATES.has(value as EvidenceState);

const includesKeyword = (modelId: string, keywords: readonly string[]) =>
  keywords.some((keyword) => modelId.includes(keyword));

const normalizeKind = (kind: string | undefined): ModelCatalogKind | undefined => {
  switch (kind?.toLowerCase()) {
    case 'chat':
    case 'embedding':
    case 'image':
    case 'moderation':
    case 'rerank':
    case 'stt':
    case 'tts': {
      return kind.toLowerCase() as ModelCatalogKind;
    }
    case 'audio.speech':
    case 'speech': {
      return 'tts';
    }
    case 'asr':
    case 'audio.transcription':
    case 'transcription': {
      return 'stt';
    }
    case 'realtime':
    case 'text2music':
    case 'video': {
      // These are intentionally non-chat. The accepted catalog contract represents
      // unsupported kinds that do not have a dedicated member as unknown.
      return 'unknown';
    }
    default: {
      return undefined;
    }
  }
};

const classifyEndpointTypes = (endpointTypes: readonly string[] | undefined) => {
  if (!endpointTypes?.length) return undefined;

  const normalized = endpointTypes.map((endpoint) => endpoint.toLowerCase());
  const find = (patterns: readonly string[]) =>
    normalized.some((endpoint) => patterns.some((pattern) => endpoint.includes(pattern)));

  // A non-chat endpoint wins over a simultaneously advertised generic chat endpoint.
  // This is deliberately conservative: catalog eligibility must never expand access.
  if (find(['rerank'])) return 'rerank' as const;
  if (find(['embedding'])) return 'embedding' as const;
  if (find(['moderation'])) return 'moderation' as const;
  if (find(['audio/speech', 'audio.speech', 'text-to-speech', 'tts'])) return 'tts' as const;
  if (find(['transcription', 'speech-to-text', 'stt', 'asr', 'whisper'])) return 'stt' as const;
  if (find(['image', 'video', 'realtime', 'music'])) {
    return find(['image']) ? ('image' as const) : ('unknown' as const);
  }
  if (find(['chat', 'responses', 'messages', 'completions'])) return 'chat' as const;

  return undefined;
};

export const classifyModelKindById = (modelId: string): KindEvidence => {
  const normalized = modelId.toLowerCase();

  // Non-chat tokens must be evaluated before any vision/reasoning family naming.
  if (includesKeyword(normalized, RERANK_KEYWORDS)) return { kind: 'rerank', source: 'keyword' };
  if (includesKeyword(normalized, EMBEDDING_KEYWORDS)) {
    return { kind: 'embedding', source: 'keyword' };
  }
  if (/(?:^|[-_/])(?:tts|speech)(?:[-_/]|$)/.test(normalized)) {
    return { kind: 'tts', source: 'keyword' };
  }
  if (
    includesKeyword(normalized, ['whisper']) ||
    /(?:^|[-_/])(?:stt|asr)(?:[-_/]|$)/.test(normalized)
  ) {
    return { kind: 'stt', source: 'keyword' };
  }
  if (includesKeyword(normalized, ['moderation'])) {
    return { kind: 'moderation', source: 'keyword' };
  }
  if (!normalized.includes('gemini') && includesKeyword(normalized, IMAGE_KEYWORDS)) {
    return { kind: 'image', source: 'keyword' };
  }
  if (includesKeyword(normalized, ['video', 'sora', 'veo', 'realtime', 'text2music'])) {
    return { kind: 'unknown', source: 'keyword' };
  }

  // Preserve forward compatibility for new chat identifiers. Hard-negative
  // non-chat families above still win, while an unrecognised identifier is a
  // selectable chat model with explicitly unverified/default evidence.
  return { kind: 'chat', source: 'default' };
};

const isManualOverrideActive = (
  manual: ModelCatalogManualOverride | undefined,
  now: Date,
): manual is ModelCatalogManualOverride => {
  if (
    typeof manual?.reason !== 'string' ||
    !manual.reason.trim() ||
    typeof manual.owner !== 'string' ||
    !manual.owner.trim() ||
    typeof manual.createdAt !== 'string' ||
    !manual.createdAt
  ) {
    return false;
  }
  if (!manual.expiresAt) return true;
  if (typeof manual.expiresAt !== 'string') return false;

  const expiresAt = Date.parse(manual.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
};

const isObservedEvidenceFresh = (
  observed: ModelCatalogObservedEvidence | undefined,
  providerModelVersion: string | undefined,
  now: Date,
): observed is ModelCatalogObservedEvidence => {
  if (!observed || typeof observed.verifiedAt !== 'string') return false;
  const verifiedAt = Date.parse(observed.verifiedAt);
  if (!Number.isFinite(verifiedAt) || now.getTime() - verifiedAt > OBSERVED_EVIDENCE_TTL_MS) {
    return false;
  }
  if (
    observed.modelVersion &&
    providerModelVersion &&
    observed.modelVersion !== providerModelVersion
  ) {
    return false;
  }

  return true;
};

const resolveKind = (
  input: ModelCatalogMergeInput,
  activeManual: ModelCatalogManualOverride | undefined,
  drift: ModelCatalogDrift[],
): KindEvidence => {
  const providerKind =
    classifyEndpointTypes(input.providerMetadata?.endpointTypes) ??
    normalizeKind(input.providerMetadata?.declaredKind);
  const catalogKind = normalizeKind(input.catalog?.kind);
  const keywordKind = classifyModelKindById(input.modelId);
  const lowerCandidates: KindEvidence[] = [
    ...(providerKind ? [{ kind: providerKind, source: 'provider-meta' as const }] : []),
    ...(catalogKind ? [{ kind: catalogKind, source: 'catalog' as const }] : []),
    keywordKind,
  ];

  const selected: KindEvidence = activeManual?.denyChat
    ? (lowerCandidates[0] ?? keywordKind)
    : activeManual?.allowChat
      ? { kind: 'chat', source: 'manual' }
      : activeManual?.kind
        ? { kind: activeManual.kind, source: 'manual' }
        : (lowerCandidates[0] ?? keywordKind);

  for (const candidate of lowerCandidates) {
    if (candidate.kind !== selected.kind) {
      drift.push({
        conflictingSource: candidate.source,
        conflictingValue: candidate.kind,
        field: 'kind',
        selectedSource: selected.source,
        selectedValue: selected.kind,
      });
    }
  }

  return selected;
};

const normalizeModality = (value: string): InputModality | undefined => {
  const normalized = value.toLowerCase();
  if (normalized === 'vision' || normalized === 'images') return 'image';
  if (normalized === 'files') return 'file';
  return INPUT_MODALITIES.find((modality) => modality === normalized);
};

const getProviderModalityEvidence = (
  metadata: ModelCatalogProviderMetadata | undefined,
): Partial<Record<InputModality, EvidenceState>> => {
  if (!metadata) return {};
  const result = { ...metadata.inputModalities };

  for (const value of metadata.supportedInputModalities ?? []) {
    const modality = normalizeModality(value);
    if (modality) result[modality] = 'supported';
  }
  for (const value of metadata.unsupportedInputModalities ?? []) {
    const modality = normalizeModality(value);
    if (modality) result[modality] = 'unsupported';
  }

  return result;
};

const getCatalogModalityEvidence = (
  catalog: ModelCatalogFallback | undefined,
): Partial<Record<InputModality, EvidenceState>> => {
  if (!catalog) return {};
  const result = { ...catalog.inputModalities };
  const setBooleanEvidence = (modality: InputModality, value: boolean | undefined) => {
    if (value !== undefined && result[modality] === undefined) {
      result[modality] = value ? 'supported' : 'unsupported';
    }
  };

  setBooleanEvidence('image', catalog.abilities?.vision);
  setBooleanEvidence('file', catalog.abilities?.files);
  setBooleanEvidence('video', catalog.abilities?.video);

  return result;
};

const mergeModalities = ({
  activeManual,
  catalog,
  drift,
  kind,
  observed,
  provider,
}: {
  activeManual?: ModelCatalogManualOverride;
  catalog: Partial<Record<InputModality, EvidenceState>>;
  drift: ModelCatalogDrift[];
  kind: KindEvidence;
  observed?: ModelCatalogObservedEvidence;
  provider: Partial<Record<InputModality, EvidenceState>>;
}) => {
  const inputModalities = {} as Record<InputModality, EvidenceState>;
  const abilitySources: ModelCatalogEntry['abilitySources'] = {};

  for (const modality of INPUT_MODALITIES) {
    const candidates: ModalityCandidate[] = [
      ...(isEvidenceState(activeManual?.inputModalities?.[modality])
        ? [
            {
              source: `manual:${activeManual.owner}`,
              state: activeManual.inputModalities[modality]!,
            },
          ]
        : []),
      ...(isEvidenceState(observed?.inputModalities?.[modality])
        ? [{ source: 'observed', state: observed.inputModalities[modality]! }]
        : []),
      ...(isEvidenceState(provider[modality])
        ? [{ source: 'provider-meta', state: provider[modality]! }]
        : []),
      ...(isEvidenceState(catalog[modality])
        ? [{ source: 'catalog', state: catalog[modality]! }]
        : []),
      ...(modality === 'text' && kind.kind === 'chat'
        ? [{ source: `${kind.source}:chat-kind`, state: 'supported' as const }]
        : []),
    ];
    const selected =
      (candidates[0]?.source.startsWith('manual:')
        ? candidates[0]
        : candidates.find((candidate) => candidate.state !== 'unknown')) ??
      ({ source: 'unknown', state: 'unknown' } satisfies ModalityCandidate);

    inputModalities[modality] = selected.state;
    abilitySources[modality] = selected.source;

    for (const candidate of candidates) {
      if (
        candidate.state !== 'unknown' &&
        selected.state !== 'unknown' &&
        candidate.state !== selected.state
      ) {
        drift.push({
          conflictingSource: candidate.source,
          conflictingValue: candidate.state,
          field: `inputModalities.${modality}`,
          selectedSource: selected.source,
          selectedValue: selected.state,
        });
      }
    }
  }

  return { abilitySources, inputModalities };
};

const resolveContextWindow = ({
  activeManual,
  catalog,
  drift,
  inferred,
  observed,
  provider,
}: {
  activeManual?: ModelCatalogManualOverride;
  catalog?: number;
  drift: ModelCatalogDrift[];
  inferred?: number;
  observed?: ModelCatalogObservedEvidence;
  provider?: number;
}): {
  candidate: ContextWindowCandidate;
  source: ContextWindowSource;
  tokens: number;
} => {
  const candidates: ContextWindowCandidate[] = [
    ...(isPositiveNumber(activeManual?.contextWindowTokens)
      ? [{ source: 'manual' as const, tokens: activeManual.contextWindowTokens }]
      : []),
    ...(isPositiveNumber(provider) ? [{ source: 'provider-meta' as const, tokens: provider }] : []),
    ...(isPositiveNumber(catalog) ? [{ source: 'catalog' as const, tokens: catalog }] : []),
    ...(isPositiveNumber(inferred) ? [{ source: 'inferred' as const, tokens: inferred }] : []),
  ];
  const candidate = candidates[0] ?? ({ source: 'unknown', tokens: 32_000 } as const);
  let selected: { source: ContextWindowSource; tokens: number } = candidate;

  if (
    isPositiveNumber(observed?.contextWindowRejectionTokens) &&
    !(activeManual?.forceContextWindow && isPositiveNumber(activeManual.contextWindowTokens)) &&
    observed.contextWindowRejectionTokens < selected.tokens
  ) {
    selected = { source: 'observed', tokens: observed.contextWindowRejectionTokens };
  }

  for (const candidate of [
    ...candidates,
    ...(isPositiveNumber(observed?.contextWindowRejectionTokens)
      ? [{ source: 'observed' as const, tokens: observed.contextWindowRejectionTokens }]
      : []),
  ]) {
    if (candidate.tokens !== selected.tokens) {
      drift.push({
        conflictingSource: candidate.source,
        conflictingValue: candidate.tokens,
        field: 'contextWindowTokens',
        selectedSource: selected.source,
        selectedValue: selected.tokens,
      });
    }
  }

  return { ...selected, candidate };
};

/**
 * Pure, source-aware classifier/merge seam shared by sync paths and client selectors.
 * Callers must supply manual data only after an exact provider/model id match.
 */
export const mergeModelCatalogEntry = (input: ModelCatalogMergeInput): PersistedModelCatalog => {
  const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  const activeManual = isManualOverrideActive(input.manual, now) ? input.manual : undefined;
  const observed = isObservedEvidenceFresh(
    input.observed,
    input.providerMetadata?.modelVersion,
    now,
  )
    ? input.observed
    : undefined;
  const drift: ModelCatalogDrift[] = [];
  const kind = resolveKind(input, activeManual, drift);
  const modalities = mergeModalities({
    activeManual,
    catalog: getCatalogModalityEvidence(input.catalog),
    drift,
    kind,
    observed,
    provider: getProviderModalityEvidence(input.providerMetadata),
  });
  const contextWindow = resolveContextWindow({
    activeManual,
    catalog: input.catalog?.contextWindowTokens,
    drift,
    inferred: input.inferredContextWindowTokens,
    observed,
    provider: input.providerMetadata?.contextWindowTokens,
  });

  return {
    contextWindowCandidate: {
      ...contextWindow.candidate,
      ...(contextWindow.candidate.source === 'provider-meta' && input.providerMetadata?.verifiedAt
        ? { verifiedAt: input.providerMetadata.verifiedAt }
        : {}),
    },
    denied: Boolean(activeManual?.denyChat),
    drift,
    entry: {
      abilitySources: modalities.abilitySources,
      contextWindowSource: contextWindow.source,
      contextWindowTokens: contextWindow.tokens,
      inputModalities: modalities.inputModalities,
      kind: kind.kind,
      kindSource: kind.source,
      maxOutput:
        activeManual?.maxOutput ?? input.providerMetadata?.maxOutput ?? input.catalog?.maxOutput,
      modelId: input.modelId,
      modelVersion: input.providerMetadata?.modelVersion,
      providerId: input.providerId,
      verifiedAt: input.providerMetadata?.verifiedAt ?? observed?.verifiedAt,
    },
    ...(input.manual ? { manual: input.manual } : {}),
    ...(input.observed ? { observed: input.observed } : {}),
    version: 1,
  };
};

/** Apply a provider-authored rejection without rebuilding unrelated catalog evidence. */
export const recordContextWindowRejectionEvidence = (
  catalog: PersistedModelCatalog,
  input: ContextWindowRejectionEvidenceInput,
): PersistedModelCatalog => {
  if (!isPositiveNumber(input.contextWindowRejectionTokens)) {
    throw new RangeError('contextWindowRejectionTokens must be a positive number');
  }

  const verifiedAt = new Date(input.verifiedAt);
  if (!Number.isFinite(verifiedAt.getTime())) throw new RangeError('verifiedAt must be valid');

  const modelVersion = input.modelVersion ?? catalog.entry.modelVersion;
  const freshExisting = isObservedEvidenceFresh(catalog.observed, modelVersion, verifiedAt)
    ? catalog.observed
    : undefined;
  const preserveLowerExisting =
    isPositiveNumber(freshExisting?.contextWindowRejectionTokens) &&
    freshExisting.contextWindowRejectionTokens <= input.contextWindowRejectionTokens;
  const observed: ModelCatalogObservedEvidence = preserveLowerExisting
    ? freshExisting
    : {
        ...catalog.observed,
        contextWindowRejectionTokens: input.contextWindowRejectionTokens,
        ...(modelVersion ? { modelVersion } : {}),
        verifiedAt: verifiedAt.toISOString(),
      };
  return refreshContextWindowEvidence({ ...catalog, observed }, verifiedAt, modelVersion);
};

const CONTEXT_WINDOW_CANDIDATE_SOURCES = new Set<ContextWindowCandidate['source']>([
  'catalog',
  'inferred',
  'manual',
  'provider-meta',
  'unknown',
]);

const getContextWindowCandidate = (catalog: PersistedModelCatalog): ContextWindowCandidate => {
  if (
    catalog.contextWindowCandidate &&
    isPositiveNumber(catalog.contextWindowCandidate.tokens) &&
    CONTEXT_WINDOW_CANDIDATE_SOURCES.has(catalog.contextWindowCandidate.source)
  ) {
    return catalog.contextWindowCandidate;
  }
  if (
    catalog.entry.contextWindowSource !== 'observed' &&
    isPositiveNumber(catalog.entry.contextWindowTokens)
  ) {
    return {
      source: catalog.entry.contextWindowSource,
      tokens: catalog.entry.contextWindowTokens,
      ...(catalog.entry.verifiedAt ? { verifiedAt: catalog.entry.verifiedAt } : {}),
    };
  }

  // Compatibility for catalog documents written before the candidate was
  // stored explicitly. Context-window drift retains the selected candidate.
  const previousCandidate = catalog.drift.find(
    ({ conflictingSource, conflictingValue, field }) =>
      field === 'contextWindowTokens' &&
      conflictingSource !== 'observed' &&
      CONTEXT_WINDOW_CANDIDATE_SOURCES.has(conflictingSource as ContextWindowCandidate['source']) &&
      isPositiveNumber(conflictingValue),
  );
  return previousCandidate
    ? {
        source: previousCandidate.conflictingSource as ContextWindowCandidate['source'],
        tokens: previousCandidate.conflictingValue as number,
      }
    : ({ source: 'unknown', tokens: 32_000 } as const);
};

const refreshContextWindowEvidence = (
  catalog: PersistedModelCatalog,
  now: Date,
  providerModelVersion = catalog.entry.modelVersion,
): PersistedModelCatalog => {
  const candidate = getContextWindowCandidate(catalog);
  const activeManual = isManualOverrideActive(catalog.manual, now) ? catalog.manual : undefined;
  const observed = isObservedEvidenceFresh(catalog.observed, providerModelVersion, now)
    ? catalog.observed
    : undefined;
  const forcedManualTokens =
    activeManual?.forceContextWindow && isPositiveNumber(activeManual.contextWindowTokens)
      ? activeManual.contextWindowTokens
      : undefined;
  const selectsObserved =
    !forcedManualTokens &&
    isPositiveNumber(observed?.contextWindowRejectionTokens) &&
    observed.contextWindowRejectionTokens < candidate.tokens;
  const effective = forcedManualTokens
    ? { source: 'manual' as const, tokens: forcedManualTokens }
    : selectsObserved
      ? {
          source: 'observed' as const,
          tokens: observed.contextWindowRejectionTokens!,
        }
      : candidate;

  return {
    ...catalog,
    contextWindowCandidate: candidate,
    drift: [
      ...catalog.drift.filter(({ field }) => field !== 'contextWindowTokens'),
      ...(candidate.tokens !== effective.tokens
        ? [
            {
              conflictingSource: candidate.source,
              conflictingValue: candidate.tokens,
              field: 'contextWindowTokens' as const,
              selectedSource: effective.source,
              selectedValue: effective.tokens,
            },
          ]
        : []),
    ],
    entry: {
      ...catalog.entry,
      contextWindowSource: effective.source,
      contextWindowTokens: effective.tokens,
      ...(providerModelVersion ? { modelVersion: providerModelVersion } : {}),
    },
  };
};

export const readPersistedModelCatalog = (
  value: unknown,
  now = new Date(),
): PersistedModelCatalog | undefined => {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.entry)) return undefined;
  const entry = value.entry;
  const inputModalities = entry.inputModalities;
  if (
    typeof entry.modelId !== 'string' ||
    typeof entry.providerId !== 'string' ||
    typeof entry.kind !== 'string' ||
    !MODEL_CATALOG_KINDS.has(entry.kind as ModelCatalogKind) ||
    !isRecord(inputModalities) ||
    !INPUT_MODALITIES.every((modality) => isEvidenceState(inputModalities[modality]))
  ) {
    return undefined;
  }

  return refreshContextWindowEvidence(value as unknown as PersistedModelCatalog, now);
};

export const getModelCatalogFromSettings = (settings: unknown) => {
  if (!isRecord(settings)) return undefined;
  return readPersistedModelCatalog(settings.modelCatalog);
};

/**
 * Chat eligibility shared by selectors and runtime preflight. Identifier hard
 * negatives reject stale catalog rows, but an active manual override remains
 * authoritative and unknown/new identifiers retain the compatible chat
 * fallback defined by the catalog contract.
 */
export const isModelCatalogEntryChatEligible = (
  entry: Pick<ModelCatalogEntry, 'kind' | 'kindSource' | 'modelId'>,
): boolean => {
  const identifierEvidence = classifyModelKindById(entry.modelId);
  if (
    identifierEvidence.source === 'keyword' &&
    identifierEvidence.kind !== 'chat' &&
    entry.kindSource !== 'manual'
  ) {
    return false;
  }
  return entry.kind === 'chat';
};

export const isPersistedModelChatEligible = (catalog: PersistedModelCatalog) =>
  !catalog.denied && isModelCatalogEntryChatEligible(catalog.entry);

export const isAiProviderModelChatEligible = (model: {
  id: string;
  providerId?: string;
  settings?: unknown;
  type?: AiModelType;
}) => {
  const persisted = getModelCatalogFromSettings(model.settings);
  if (
    persisted &&
    persisted.entry.modelId === model.id &&
    (!model.providerId || persisted.entry.providerId === model.providerId)
  ) {
    return isPersistedModelChatEligible(persisted);
  }

  // A legacy remote `chat` value may only be a default. Reclassify it from the
  // identifier, while retaining explicit non-chat types as stronger evidence.
  const fallback = mergeModelCatalogEntry({
    modelId: model.id,
    providerId: model.providerId ?? 'unknown',
    providerMetadata:
      model.type && model.type !== 'chat' ? { declaredKind: model.type } : undefined,
  });
  return isPersistedModelChatEligible(fallback);
};

export const filterAiProviderChatEligibleModels = <
  T extends {
    id: string;
    providerId?: string;
    settings?: unknown;
    type?: AiModelType;
  },
>(
  models: readonly T[],
): T[] => models.filter(isAiProviderModelChatEligible);

/** Pure serialization seam; runtime wiring freezes this exact value per operation. */
export const createModelCatalogSnapshot = (
  entry: ModelCatalogEntry,
  operationId: string,
  capturedAt = new Date().toISOString(),
): ModelCatalogSnapshot => ({
  capturedAt,
  entry: {
    ...entry,
    ...(entry.capabilities ? { capabilities: { ...entry.capabilities } } : {}),
    abilitySources: { ...entry.abilitySources },
    inputModalities: { ...entry.inputModalities },
  },
  operationId,
  version: 1,
});
