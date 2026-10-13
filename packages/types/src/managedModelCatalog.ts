import type { EnabledAiModel } from 'model-bank';
import { z } from 'zod';

const evidence = z.enum(['supported', 'unsupported', 'unknown']);
export const MANAGED_MODEL_CAPABILITIES = [
  'functionCall',
  'reasoning',
  'structuredOutput',
  'search',
  'imageOutput',
] as const;
export const MANAGED_MODEL_MODALITIES = ['text', 'image', 'audio', 'video', 'file'] as const;

export const ManagedModelDescriptionSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  organization: z.string().trim().max(100).default(''),
  description: z.string().trim().max(10000).default(''),
  limitations: z.string().trim().max(10000).default(''),
  sourceUrl: z
    .union([
      z
        .string()
        .url()
        .refine((v) => /^https?:\/\//.test(v)),
      z.literal(''),
    ])
    .default(''),
  kind: z
    .enum(['chat', 'embedding', 'image', 'video', 'tts', 'stt', 'rerank', 'moderation', 'unknown'])
    .default('chat'),
  contextWindowTokens: z.number().int().positive().max(2147483647).nullable().default(null),
  maxOutput: z.number().int().positive().max(2147483647).nullable().default(null),
  inputModalities: z.object({
    text: evidence,
    image: evidence,
    audio: evidence,
    video: evidence,
    file: evidence,
  }),
  capabilities: z.object({
    functionCall: evidence,
    reasoning: evidence,
    structuredOutput: evidence,
    search: evidence,
    imageOutput: evidence,
  }),
  referencePricing: z
    .object({
      currency: z.enum(['CNY', 'USD']),
      input: z.number().finite().nonnegative().nullable(),
      output: z.number().finite().nonnegative().nullable(),
      cacheRead: z.number().finite().nonnegative().nullable(),
      cacheWrite: z.number().finite().nonnegative().nullable(),
      source: z.string().trim().min(1).max(1000),
    })
    .nullable()
    .default(null),
});
export type ManagedModelDescription = z.infer<typeof ManagedModelDescriptionSchema>;
export interface ManagedModelRecord {
  draft: ManagedModelDescription;
  modelId: string;
  published: ManagedModelDescription | null;
  publishedRevision: string | null;
  updatedAt: Date;
  version: number;
}
export interface ManagedModelRevision {
  actorUserId: string | null;
  createdAt: Date;
  description: ManagedModelDescription;
  id: string;
  modelId: string;
  reason: string;
}
export interface ModelCatalogSettings {
  enabled: boolean;
  generation: string;
  silentRefreshEnabled: boolean;
}
export type SilentModelCatalogResponse =
  | { status: 'disabled' | 'unavailable' }
  | { status: 'unchanged'; revision: string; stale: boolean }
  | { status: 'changed'; revision: string; stale: boolean; models: EnabledAiModel[] };

export const createEmptyModelDescription = (modelId: string): ManagedModelDescription =>
  ManagedModelDescriptionSchema.parse({
    displayName: modelId,
    inputModalities: {
      text: 'unknown',
      image: 'unknown',
      audio: 'unknown',
      video: 'unknown',
      file: 'unknown',
    },
    capabilities: {
      functionCall: 'unknown',
      reasoning: 'unknown',
      structuredOutput: 'unknown',
      search: 'unknown',
      imageOutput: 'unknown',
    },
  });
