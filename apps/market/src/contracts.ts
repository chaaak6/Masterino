import { z } from 'zod';

export const ResourceTypeSchema = z.enum([
  'agent',
  'agent-group',
  'skill',
  'mcp',
  'plugin',
  'model',
  'provider',
]);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const WorkflowStateSchema = z.enum([
  'draft',
  'submitted',
  'scanning',
  'in_review',
  'approved',
  'rejected',
  'published',
  'deprecated',
]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const ResourceVisibilitySchema = z.enum(['internal', 'private', 'public']);
export type ResourceVisibility = z.infer<typeof ResourceVisibilitySchema>;

export const AdminResourceListQuerySchema = z.object({
  clientVisible: z
    .enum(['false', 'true'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(50).optional(),
  type: ResourceTypeSchema.optional(),
  visibility: ResourceVisibilitySchema.optional(),
  workflowState: WorkflowStateSchema.optional(),
});

export const TrustedClientPayloadSchema = z.object({
  clientId: z.string().min(1),
  email: z.string().optional(),
  name: z.string().optional(),
  nonce: z.string().min(1),
  timestamp: z.number(),
  userId: z.string().min(1),
  workspaceId: z.string().optional(),
});
export type TrustedClientPayload = z.infer<typeof TrustedClientPayloadSchema>;

export const ResourceInputSchema = z
  .object({
    avatar: z.string().nullish(),
    category: z.string().nullish(),
    config: z.record(z.any()).optional(),
    description: z.string().nullish(),
    editorData: z.record(z.any()).optional(),
    identifier: z.string().min(1),
    manifest: z.record(z.any()).optional(),
    name: z.string().min(1).optional(),
    tags: z.array(z.string()).optional(),
    version: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const ReviewActionSchema = z.object({
  versionId: z.number().int().positive().optional(),
  expectedState: z.string().optional(),
  action: z.enum([
    'submit',
    'scan-start',
    'scan-passed',
    'scan-failed',
    'approve',
    'reject',
    'publish',
    'deprecate',
  ]),
  reason: z.string().max(2000).optional(),
  scanResult: z.record(z.any()).optional(),
});

export const OfflineImportSchema = z.object({
  payload: z.object({
    exportedAt: z.string(),
    resources: z.array(
      z.object({
        artifact: z
          .object({
            contentBase64: z.string().optional(),
            sha256: z
              .string()
              .regex(/^[a-f\d]{64}$/i)
              .optional(),
          })
          .optional(),
        resource: ResourceInputSchema,
        type: ResourceTypeSchema,
      }),
    ),
  }),
  signature: z.string().min(1),
});

export const CredentialInputSchema = z
  .object({
    description: z.string().optional(),
    key: z.string().min(1),
    name: z.string().optional(),
    type: z.enum(['kv-env', 'kv-header', 'oauth', 'file']),
    value: z.any(),
  })
  .passthrough();

export const ConnectorRunSchema = z.object({
  body: z.any().optional(),
  bodyEncoding: z.enum(['json', 'form']).default('json'),
  headers: z.record(z.string()).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  provider: z.string().min(1),
  url: z.string().url(),
});
