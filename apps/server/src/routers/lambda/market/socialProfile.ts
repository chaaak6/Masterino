import { readFile } from 'node:fs/promises';

import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { marketSDK, marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GitHub } from '@/server/modules/GitHub';
import { FileService } from '@/server/services/file';
import { SkillManifestError, SkillParseError } from '@/server/services/skill/errors';
import { SkillParser } from '@/server/services/skill/parser';
import { SkillPublishingService } from '@/server/services/skill/publishing';
import { assertSafeSkillPackageContent } from '@/server/services/skill/submissionPolicy';
import { getInternalMarketBaseUrl } from '@/utils/internalMarket';

const log = debug('lambda-router:market:socialProfile');

// Authenticated procedure for social profile operations
const socialProfileAuthProcedure = authedProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(marketSDK);

export interface ClaimableResource {
  description?: string;
  id: number;
  identifier: string;
  name?: string;
  parsedUrl?: {
    fullName: string;
    owner: string;
    repo: string;
  };
  type: 'plugin' | 'skill';
  url?: string;
}

export interface ClaimableResources {
  plugins: ClaimableResource[];
  skills: ClaimableResource[];
}

export interface SubmissionResult {
  issues: string[];
  resourceId?: number;
  source: { commit?: string; type: 'github' | 'mcp' | 'zip'; url?: string };
  status: 'submitted';
  versionId?: number;
}

const MAX_SKILL_ARCHIVE_BYTES = 16 * 1024 * 1024;

const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z\d]+/g, '-')
    .replaceAll(/^-|-$/g, '') || 'skill';

const submitSkillArchive = async (input: {
  actAs?: number;
  archive: Buffer;
  headers: Record<string, string>;
  identifier: string;
  metadata: Record<string, unknown>;
  source: SubmissionResult['source'];
  version: string;
}) => {
  if (input.archive.length > MAX_SKILL_ARCHIVE_BYTES) {
    throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Skill archive exceeds 16 MiB' });
  }
  const parser = new SkillParser();
  const parsed = await parser.parseZipPackage(input.archive, { repackSkillZip: true });
  assertSafeSkillPackageContent(parsed);
  const archive = parsed.skillZipBuffer ?? input.archive;
  const manifest = {
    ...parsed.manifest,
    files: [
      { path: 'SKILL.md', type: 'file' },
      ...[...parsed.resources.keys()].sort().map((path) => ({ path, type: 'file' })),
    ],
    source: input.source,
  };
  const form = new FormData();
  form.set(
    'file',
    new Blob([new Uint8Array(archive)], { type: 'application/zip' }),
    `${input.identifier}.zip`,
  );
  form.set('manifest', JSON.stringify(manifest));
  form.set('metadata', JSON.stringify(input.metadata));
  form.set('name', parsed.manifest.name);
  form.set('description', parsed.manifest.description || '');
  form.set('version', input.version);
  const actingHeaders = {
    ...input.headers,
    ...(input.actAs === undefined ? {} : { 'x-lobe-owner-account-id': String(input.actAs) }),
  };
  // Let fetch set the multipart boundary; SDK defaults may contain JSON Content-Type.
  const uploadHeaders = new Headers(actingHeaders);
  uploadHeaders.delete('content-type');
  const createResponse = await fetch(
    `${getInternalMarketBaseUrl()}/api/v1/user/skills/${encodeURIComponent(input.identifier)}/versions`,
    { body: form, headers: uploadHeaders, method: 'POST' },
  );
  const created = (await createResponse.json().catch(() => ({}))) as Record<string, any>;
  if (!createResponse.ok) {
    throw new TRPCError({
      code: createResponse.status === 409 ? 'CONFLICT' : 'BAD_REQUEST',
      message: String(created.error || `Failed to create Market skill: ${createResponse.status}`),
    });
  }
  const submitResponse = await fetch(
    `${getInternalMarketBaseUrl()}/api/v1/user/skills/${encodeURIComponent(input.identifier)}/status`,
    {
      body: JSON.stringify({ status: 'published' }),
      headers: { ...actingHeaders, 'Content-Type': 'application/json' },
      method: 'PATCH',
    },
  );
  if (!submitResponse.ok) {
    const error = (await submitResponse.json().catch(() => ({}))) as Record<string, any>;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: String(error.error || `Failed to submit Market skill: ${submitResponse.status}`),
    });
  }
  return {
    issues: [],
    resourceId: created.resourceId,
    source: input.source,
    status: 'submitted',
    versionId: created.id,
  } satisfies SubmissionResult;
};

export const socialProfileRouter = router({
  submitMcp: socialProfileAuthProcedure
    .input(
      z.object({
        actAs: z.number().int().positive().optional(),
        authType: z.enum(['none', 'oauth2']),
        description: z.string().trim().min(1).max(500),
        name: z.string().trim().min(1).max(80),
        url: z
          .string()
          .url()
          .refine((value) => value.startsWith('https://'), 'MCP URL must use HTTPS'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // @ts-ignore - headers is protected but required for authenticated Market forwarding
      const baseHeaders = ctx.marketSDK.headers as Record<string, string>;
      const headers = {
        ...baseHeaders,
        ...(input.actAs === undefined ? {} : { 'x-lobe-owner-account-id': String(input.actAs) }),
        'Content-Type': 'application/json',
      };
      const identifier = `user-${slugify(input.name)}-${nanoid(8).toLowerCase()}`;
      const manifest = {
        deploymentOptions: [
          {
            connection: {
              auth: { type: input.authType },
              type: 'http',
              url: input.url,
            },
            isRecommended: true,
          },
        ],
        identifier,
        meta: { description: input.description, title: input.name },
        type: 'mcp',
        version: '1.0.0',
      };
      const createResponse = await fetch(
        `${getInternalMarketBaseUrl()}/api/v1/user/plugins/${encodeURIComponent(identifier)}/versions`,
        {
          body: JSON.stringify({
            description: input.description,
            identifier,
            manifest,
            metadata: { sourceCatalog: 'user-submission', sourceUrl: input.url },
            name: input.name,
            version: '1.0.0',
          }),
          headers,
          method: 'POST',
        },
      );
      const created = (await createResponse.json().catch(() => ({}))) as Record<string, any>;
      if (!createResponse.ok) {
        throw new TRPCError({
          code: createResponse.status === 409 ? 'CONFLICT' : 'BAD_REQUEST',
          message: String(created.error || `Failed to create Market MCP: ${createResponse.status}`),
        });
      }
      const submitResponse = await fetch(
        `${getInternalMarketBaseUrl()}/api/v1/user/plugins/${encodeURIComponent(identifier)}/status`,
        { body: JSON.stringify({ status: 'published' }), headers, method: 'PATCH' },
      );
      if (!submitResponse.ok) {
        const error = (await submitResponse.json().catch(() => ({}))) as Record<string, any>;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: String(error.error || `Failed to submit Market MCP: ${submitResponse.status}`),
        });
      }
      return {
        issues:
          input.authType === 'oauth2' ? ['OAuth configuration requires reviewer verification'] : [],
        source: { type: 'mcp', url: input.url },
        status: 'submitted',
        versionId: created.id,
      } satisfies SubmissionResult;
    }),

  /**
   * Claim resources (Plugins and/or Skills)
   * API expects one asset at a time: { assetId: number, assetType: 'skill' | 'plugin' }
   */
  claimResources: socialProfileAuthProcedure
    .input(
      z.object({
        pluginIds: z.array(z.string()).optional(),
        skillIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('claimResources input: %O', input);

      try {
        // @ts-ignore - headers is protected but we need it for custom API calls
        const headers = ctx.marketSDK.headers as Record<string, string>;

        const claimed: Array<{ assetId: number; assetType: string }> = [];
        const errors: string[] = [];

        // Claim each skill one by one
        for (const skillId of input.skillIds || []) {
          try {
            const response = await fetch(`${getInternalMarketBaseUrl()}/api/v1/user/claims`, {
              body: JSON.stringify({
                assetId: Number(skillId),
                assetType: 'skill',
              }),
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              method: 'POST',
            });

            if (response.ok) {
              claimed.push({ assetId: Number(skillId), assetType: 'skill' });
            } else {
              const error = await response.json().catch(() => ({}));
              errors.push(error.error || `Failed to claim skill ${skillId}`);
            }
          } catch {
            errors.push(`Failed to claim skill ${skillId}`);
          }
        }

        // Claim each plugin one by one
        for (const pluginId of input.pluginIds || []) {
          try {
            const response = await fetch(`${getInternalMarketBaseUrl()}/api/v1/user/claims`, {
              body: JSON.stringify({
                assetId: Number(pluginId),
                assetType: 'plugin',
              }),
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              method: 'POST',
            });

            if (response.ok) {
              claimed.push({ assetId: Number(pluginId), assetType: 'plugin' });
            } else {
              const error = await response.json().catch(() => ({}));
              errors.push(error.error || `Failed to claim plugin ${pluginId}`);
            }
          } catch {
            errors.push(`Failed to claim plugin ${pluginId}`);
          }
        }

        // If nothing was claimed and there were errors, throw
        if (claimed.length === 0 && errors.length > 0) {
          throw new Error(errors[0]);
        }

        return {
          claimed,
          errors: errors.length > 0 ? errors : undefined,
          success: claimed.length > 0,
        };
      } catch (error) {
        log('Error claiming resources: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to claim resources',
        });
      }
    }),

  /**
   * Scan for claimable resources (MCPs and Skills)
   */
  scanClaimableResources: socialProfileAuthProcedure.query(async ({ ctx }) => {
    log('scanClaimableResources');

    try {
      // @ts-ignore - headers is protected but we need it for custom API calls
      const headers = ctx.marketSDK.headers as Record<string, string>;

      const response = await fetch(`${getInternalMarketBaseUrl()}/api/v1/user/claims/scan`, {
        headers,
        method: 'GET',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error || `Failed to scan claimable resources: ${response.status}`;
        throw new TRPCError({
          code: response.status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
          message: errorMessage,
        });
      }

      const responseData = await response.json();
      // API returns { data: { plugins: [], skills: [] } }
      const data = responseData.data || responseData;
      return {
        plugins: (data.plugins || []) as ClaimableResource[],
        skills: (data.skills || []) as ClaimableResource[],
      };
    } catch (error) {
      log('Error scanning claimable resources: %O', error);
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to scan claimable resources',
      });
    }
  }),

  /**
   * Submit a GitHub repository URL for import
   */
  submitRepo: socialProfileAuthProcedure
    .input(
      z.object({
        actAs: z.number().int().positive().optional(),
        branch: z.string().optional(),
        gitUrl: z.string().url(),
        type: z.literal('skill').default('skill'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('submitRepo input: %O', input);

      try {
        // @ts-ignore - headers is protected but we need it for custom API calls
        const headers = ctx.marketSDK.headers as Record<string, string>;

        const github = new GitHub({
          token: process.env.MARKET_GITHUB_TOKEN,
          userAgent: 'Masterino-Market-Submission',
        });
        const parsedRepo = github.parseRepoUrl(input.gitUrl, input.branch || 'main');
        const immutableRepo = await github.resolveCommit(parsedRepo);
        const repositoryArchive = await github.downloadRepoZip(immutableRepo);
        const parser = new SkillParser();
        const parsed = await parser.parseZipPackage(repositoryArchive, {
          basePath: immutableRepo.path,
          repackSkillZip: true,
        });
        const archive = parsed.skillZipBuffer;
        if (!archive) throw new Error('Failed to build skill-only archive');
        return await submitSkillArchive({
          actAs: input.actAs,
          archive,
          headers,
          identifier: github.generateIdentifier(parsedRepo),
          metadata: {
            artifactSha256: parsed.zipHash,
            sourceCatalog: 'github',
            sourceCommit: immutableRepo.branch,
            sourceUrl: input.gitUrl,
          },
          source: { commit: immutableRepo.branch, type: 'github', url: input.gitUrl },
          version: `1.0.0-${immutableRepo.branch.slice(0, 12)}`,
        });
      } catch (error) {
        log('Error submitting repository: %O', error);
        // Re-throw TRPCError as-is
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to submit repository',
        });
      }
    }),

  submitPersonalSkill: socialProfileAuthProcedure
    .input(z.object({ skillId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      new SkillPublishingService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).submitPersonal(input.skillId),
    ),

  submitZip: socialProfileAuthProcedure
    .input(
      z.object({
        actAs: z.number().int().positive().optional(),
        zipFileId: z.string().min(1),
        sourceRef: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // @ts-ignore - headers is protected but required for authenticated Market forwarding
      const headers = ctx.marketSDK.headers as Record<string, string>;
      const fileService = new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const { cleanup, filePath } = await fileService.downloadFileToLocal(input.zipFileId, {
        maxBytes: MAX_SKILL_ARCHIVE_BYTES,
      });
      try {
        const archive = await readFile(filePath);
        if (input.actAs !== undefined) {
          const parsed = await new SkillParser().parseZipPackage(archive, { repackSkillZip: true });
          const identifier = `user-${slugify(parsed.manifest.name)}-${nanoid(8).toLowerCase()}`;
          return await submitSkillArchive({
            actAs: input.actAs,
            archive,
            headers,
            identifier,
            metadata: { sourceCatalog: 'user-upload' },
            source: { type: 'zip' },
            version: '1.0.0',
          });
        }
        return await new SkillPublishingService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ).submitArchive(archive, input.sourceRef);
      } catch (error) {
        if (error instanceof SkillManifestError || error instanceof SkillParseError) {
          throw new TRPCError({ cause: error, code: 'BAD_REQUEST', message: error.message });
        }
        throw error;
      } finally {
        cleanup();
      }
    }),
});

export type SocialProfileRouter = typeof socialProfileRouter;
