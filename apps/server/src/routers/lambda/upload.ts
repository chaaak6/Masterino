import { SKILL_SOURCE_MAX_BYTES } from '@lobechat/skill-package';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { appEnv } from '@/envs/app';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { FileS3 } from '@/server/modules/S3';
import { createS3UploadProxyUrl } from '@/server/services/file/uploadProxyToken';

const getBrowserUploadUrl = (proxyUrl: string): string => {
  try {
    const configuredUrl = new URL(appEnv.APP_URL);
    const hostname = configuredUrl.hostname.toLowerCase();
    const isLoopback =
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('127.') ||
      hostname === '[::1]' ||
      hostname === '::1';

    if (configuredUrl.protocol !== 'https:' || isLoopback) return proxyUrl;

    return new URL(proxyUrl, configuredUrl.origin).href;
  } catch {
    return proxyUrl;
  }
};

export const uploadRouter = router({
  createS3PreSignedUpload: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      z.object({
        pathname: z.string(),
        source: z.literal('skill').optional(),
        size: z.number().int().positive().max(SKILL_SOURCE_MAX_BYTES).optional(),
        hash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.source && (!input.size || !input.hash || !input.pathname.startsWith('skills/')))
        throw new Error('Invalid skill upload claim');
      const claim = input.source
        ? { source: input.source, size: input.size!, hash: input.hash! }
        : undefined;
      const proxyUrl = createS3UploadProxyUrl(input.pathname, Date.now(), claim);
      const upload: {
        headers?: Record<string, string>;
        requiresConfirmation?: true;
        url: string;
      } = {
        requiresConfirmation: true,
        url: getBrowserUploadUrl(proxyUrl),
      };

      return upload;
    }),
  createS3PreSignedUrl: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(z.object({ pathname: z.string() }))
    .mutation(async ({ input }) => {
      const s3 = new FileS3();

      return await s3.createPreSignedUrl(input.pathname);
    }),
});

export type FileRouter = typeof uploadRouter;
