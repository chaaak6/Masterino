import { MARKET_AUTH_REQUIRED_MESSAGE } from '@lobechat/desktop-bridge';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { type ToolCallContent } from '@/libs/mcp';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, serverDatabase, telemetry } from '@/libs/trpc/lambda/middleware';
import { marketSDK, requireMarketAuth } from '@/libs/trpc/lambda/middleware/marketSDK';
import { isTrustedClientEnabled } from '@/libs/trusted-client';
import { DiscoverService } from '@/server/services/discover';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import {
  contentBlocksToString,
  processContentBlocks,
} from '@/server/services/mcp/contentProcessor';
import { createSandboxService, getSandboxProviderKind } from '@/server/services/sandbox';
import { validateSkillActivationResult } from '@/server/services/toolExecution/skillActivationResult';

import { scheduleToolCallReport } from './_helpers';
import {
  isMarketConnectionsTimeoutError,
  listOptionalMarketConnectionsWithTimeout,
  MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS,
} from './_helpers/marketConnections';
import { assertLegacySandboxSkillBoundary } from './_helpers/skillExecutionBoundary';

const log = debug('lobe-server:tools:market');

const isSandboxAuthError = (error?: { message?: string; name?: string }) => {
  const code = error?.name;
  const message = error?.message || '';

  return (
    code === 'invalid_token' ||
    code === 'token_expired' ||
    code === 'unauthorized' ||
    message.toLowerCase().includes('invalid_token') ||
    message.toLowerCase().includes('token expired') ||
    message.toLowerCase().includes('unauthorized')
  );
};

const throwSandboxAuthError = () => {
  throw new TRPCError({
    code: 'UNAUTHORIZED',
    message: MARKET_AUTH_REQUIRED_MESSAGE,
  });
};

// ============================== Common Procedure ==============================
const marketToolProcedure = wsCompatProcedure
  .use(serverDatabase)
  .use(telemetry)
  .use(marketUserInfo)
  .use(async ({ ctx, next }) => {
    const { UserModel } = await import('@/database/models/user');
    const userModel = new UserModel(ctx.serverDB, ctx.userId);

    // In a workspace context, sandbox runtime calls are attributed to the
    // workspace's Market organization via the workspaceId carried in the trust
    // token (`ctx.marketUserInfo.workspaceId`, set by the marketUserInfo
    // middleware). Falls back to the personal account when there's no workspace.
    return next({
      ctx: {
        discoverService: new DiscoverService({
          accessToken: ctx.marketAccessToken,
          userInfo: ctx.marketUserInfo,
        }),
        fileService: new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
        marketService: new MarketService({
          accessToken: ctx.marketAccessToken,
          userInfo: ctx.marketUserInfo,
        }),
        userModel,
        workspaceId: ctx.workspaceId,
      },
    });
  });

// Sandbox requests must select their configured provider before constructing
// any provider-specific dependency. In particular, Onlyboxes does not require
// MARKET_BASE_URL and must not initialize MarketService as a side effect.
const sandboxToolProcedure = wsCompatProcedure
  .use(serverDatabase)
  .use(telemetry)
  .use(marketUserInfo)
  .use(async ({ ctx, next }) => {
    const { UserModel } = await import('@/database/models/user');
    const userModel = new UserModel(ctx.serverDB, ctx.userId);
    const marketService =
      getSandboxProviderKind() === 'market'
        ? new MarketService({
            accessToken: ctx.marketAccessToken,
            userInfo: ctx.marketUserInfo,
          })
        : undefined;

    return next({
      ctx: {
        fileService: new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
        marketService,
        userModel,
        workspaceId: ctx.workspaceId,
      },
    });
  });

// ============================== LobeHub Skill Procedures ==============================
/**
 * LobeHub Skill procedure with SDK and optional auth
 * Used for routes that may work without auth (like listing providers)
 */
const lobehubSkillBaseProcedure = authedProcedure
  .use(serverDatabase)
  .use(telemetry)
  .use(marketUserInfo)
  .use(marketSDK);

/**
 * LobeHub Skill procedure with required auth
 * Used for routes that require user authentication
 */
const lobehubSkillAuthProcedure = lobehubSkillBaseProcedure.use(requireMarketAuth);

// ============================== Schema Definitions ==============================

// Schema for metadata that frontend needs to pass (for cloud MCP reporting)
const metaSchema = z
  .object({
    customPluginInfo: z
      .object({
        avatar: z.string().optional(),
        description: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    isCustomPlugin: z.boolean().optional(),
    sessionId: z.string().optional(),
    version: z.string().optional(),
  })
  .optional();

// Schema for sandbox tool execution request
const execInSandboxSchema = z.object({
  params: z.record(z.any()),
  toolName: z.string(),
  topicId: z.string(),
  userId: z.string().optional(), // Optional: fallback to ctx.userId if not provided
});

// Schema for export and upload file (combined operation)
const exportAndUploadFileSchema = z.object({
  filename: z.string(),
  path: z.string(),
  topicId: z.string(),
});

// Schema for cloud MCP endpoint call
const callCloudMcpEndpointSchema = z.object({
  apiParams: z.record(z.any()),
  identifier: z.string(),
  meta: metaSchema,
  toolName: z.string(),
});

// ============================== Type Exports ==============================
export type ExecInSandboxInput = z.infer<typeof execInSandboxSchema>;
/** @deprecated Use ExecInSandboxInput */
export type CallCodeInterpreterToolInput = ExecInSandboxInput;
export type ExportAndUploadFileInput = z.infer<typeof exportAndUploadFileSchema>;

export interface CallToolResult {
  error?: {
    message: string;
    name?: string;
  };
  result: any;
  sessionExpiredAndRecreated?: boolean;
  success: boolean;
}

export interface ExportAndUploadFileResult {
  error?: {
    code: string;
    message: string;
    name?: string;
    retryable: boolean;
    stage: 'fallback' | 'inspect' | 'metadata' | 'record' | 'sign' | 'upload';
  };
  fileId?: string;
  filename: string;
  mimeType?: string;
  size?: number;
  success: boolean;
  url?: string;
}

// ============================== Sandbox Handler ==============================
const execInSandboxHandler = async ({
  input,
  ctx,
}: {
  ctx: {
    fileService: FileService;
    marketService?: MarketService;
    serverDB: any;
    userId: string;
    workspaceId?: string | null;
  };
  input: ExecInSandboxInput;
}): Promise<CallToolResult> => {
  const { toolName, params, topicId } = input;
  const userId = input?.userId || ctx.userId;

  log('execInSandbox: tool=%s, topicId=%s', toolName, topicId);

  try {
    // This legacy endpoint has no authoritative operation registry. Plain
    // user-authored commands remain supported; ZIP skill preparation belongs
    // to the operation-bound SkillsExecutionRuntime/server service.
    assertLegacySandboxSkillBoundary(toolName, params);
    let enhancedParams = params;

    // Preprocess lh commands: rewrite to npx @lobehub/cli + inject auth env vars
    if ((toolName === 'execScript' || toolName === 'runCommand') && params.command) {
      const { preprocessLhCommand } =
        await import('@/server/services/toolExecution/preprocessLhCommand');
      const lhResult = await preprocessLhCommand(params.command, userId);

      if (lhResult.error) {
        return {
          error: { message: lhResult.error, name: 'AuthError' },
          result: null,
          sessionExpiredAndRecreated: false,
          success: false,
        };
      }

      if (lhResult.skipSkillLookup) {
        enhancedParams = { ...params, command: lhResult.command };
      }
    }

    const sandboxService = createSandboxService({
      fileService: ctx.fileService,
      marketService: ctx.marketService,
      serverDB: ctx.serverDB,
      topicId,
      userId,
    });

    const response = await sandboxService.callTool(toolName, enhancedParams);

    log('execInSandbox response for %s: %O', toolName, response);

    if (!response.success && isSandboxAuthError(response.error)) {
      throwSandboxAuthError();
    }

    return response;
  } catch (error) {
    log('execInSandbox error for %s: %O', toolName, error);

    // Re-throw TRPCError as-is (e.g., UNAUTHORIZED from above)
    if (error instanceof TRPCError) {
      throw error;
    }

    const errorMessage = (error as Error).message;

    // Check for authentication errors thrown as exceptions
    if (
      errorMessage.toLowerCase().includes('invalid_token') ||
      errorMessage.toLowerCase().includes('token expired') ||
      errorMessage.toLowerCase().includes('unauthorized')
    ) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: MARKET_AUTH_REQUIRED_MESSAGE,
      });
    }

    return {
      error: {
        message: errorMessage,
        name: (error as Error).name,
      },
      result: null,
      sessionExpiredAndRecreated: false,
      success: false,
    };
  }
};

// ============================== Router ==============================
export const marketRouter = router({
  // ============================== Cloud MCP Gateway ==============================
  callCloudMcpEndpoint: marketToolProcedure
    .input(callCloudMcpEndpointSchema)
    .mutation(async ({ input, ctx }) => {
      log('callCloudMcpEndpoint input: %O', input);

      const startTime = Date.now();
      let success = true;
      let errorCode: string | undefined;
      let errorMessage: string | undefined;
      let result: { content: string; state: any; success: boolean } | undefined;

      try {
        // Check if trusted client is enabled - if so, we don't need user's accessToken
        const trustedClientEnabled = isTrustedClientEnabled();

        let userAccessToken: string | undefined;

        if (!trustedClientEnabled) {
          // Query user_settings to get market.accessToken only if trusted client is not enabled
          const userState = await ctx.userModel.getUserState(async () => ({}));
          userAccessToken = userState.settings?.market?.accessToken;

          log('callCloudMcpEndpoint: userAccessToken exists=%s', !!userAccessToken);

          if (!userAccessToken) {
            throw new TRPCError({
              code: 'UNAUTHORIZED',
              message: 'User access token not found. Please sign in to Market first.',
            });
          }
        } else {
          log('callCloudMcpEndpoint: using trusted client authentication');
        }

        const cloudResult = await ctx.discoverService.callCloudMcpEndpoint({
          apiParams: input.apiParams,
          identifier: input.identifier,
          toolName: input.toolName,
          userAccessToken,
        });
        const cloudResultContent = (cloudResult?.content ?? []) as ToolCallContent[];

        // Format the cloud result to MCPToolCallResult format
        // Process content blocks (upload images, etc.)
        const newContent =
          cloudResult?.isError || !ctx.fileService
            ? cloudResultContent
            : await processContentBlocks(cloudResultContent, ctx.fileService);

        // Convert content blocks to string
        const content = contentBlocksToString(newContent);
        const state = { ...cloudResult, content: newContent };

        result = { content, state, success: true };
        return result;
      } catch (error) {
        success = false;
        const err = error as Error;
        errorCode = 'CALL_FAILED';
        errorMessage = err.message;

        log('Error calling cloud MCP endpoint: %O', error);

        // Re-throw TRPCError as-is
        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to call cloud MCP endpoint',
        });
      } finally {
        scheduleToolCallReport({
          errorCode,
          errorMessage,
          identifier: input.identifier,
          marketAccessToken: ctx.marketAccessToken,
          mcpType: 'cloud',
          meta: input.meta,
          requestPayload: input.apiParams,
          result,
          startTime,
          success,
          telemetryEnabled: ctx.telemetryEnabled,
          toolName: input.toolName,
        });
      }
    }),

  /** @deprecated Use execInSandbox instead. Will be removed in a future version. */
  callCodeInterpreterTool: sandboxToolProcedure
    .input(execInSandboxSchema)
    .mutation(({ input, ctx }) => execInSandboxHandler({ ctx, input })),

  executeSkillTool: sandboxToolProcedure
    .input(
      z.object({
        apiName: z.enum(['activateSkill', 'readReference', 'execScript']),
        messageId: z.string().min(1),
        topicId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { AiAgentService } = await import('@/server/services/aiAgent');
      const { skillsRuntime } =
        await import('@/server/services/toolExecution/serverRuntimes/skills');
      const service = new AiAgentService(ctx.serverDB, ctx.userId, {
        workspaceId: ctx.workspaceId ?? undefined,
      });
      const binding = await service.resolveClientSkillToolContext(input);
      const runtime = await skillsRuntime.factory(binding.context);
      switch (input.apiName) {
        case 'activateSkill': {
          const result = await runtime.activateSkill(
            z.object({ name: z.string().min(1) }).parse(binding.args),
          );
          return validateSkillActivationResult(
            binding.context.skillRegistryResult.skills,
            {
              apiName: input.apiName,
              identifier: 'lobe-skills',
              id: binding.context.toolCallId,
            },
            result,
            binding.context.operationId,
          ).result;
        }
        case 'readReference': {
          return runtime.readReference(
            z.object({ id: z.string().min(1), path: z.string().min(1) }).parse(binding.args),
          );
        }
        case 'execScript': {
          return runtime.execScript(
            z
              .object({
                skillId: z.string().optional(),
                command: z.string().min(1),
                description: z.string().default(''),
              })
              .parse(binding.args),
          );
        }
      }
    }),

  // ============================== Sandbox Execution ==============================
  execInSandbox: sandboxToolProcedure
    .input(execInSandboxSchema)
    .mutation(({ input, ctx }) => execInSandboxHandler({ ctx, input })),

  // ============================== LobeHub Skill ==============================
  /**
   * Call a LobeHub Skill tool
   */
  connectCallTool: lobehubSkillAuthProcedure
    .input(
      z.object({
        args: z.record(z.any()).optional(),
        provider: z.string(),
        toolName: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { provider, toolName, args, topicId } = input;
      log('connectCallTool: provider=%s, tool=%s, topicId=%s', provider, toolName, topicId);
      try {
        const response = await ctx.marketSDK.skills.callTool(provider, {
          args: args || {},
          tool: toolName,
          // @ts-ignore
          topicId,
        });

        log('connectCallTool response: %O', response);

        return {
          data: response.data,
          success: response.success,
        };
      } catch (error) {
        const errorMessage = (error as Error).message;
        log('connectCallTool error: %s', errorMessage);

        if (errorMessage.includes('NOT_CONNECTED')) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Provider not connected. Please authorize first.',
          });
        }

        if (errorMessage.includes('TOKEN_EXPIRED')) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Token expired. Please re-authorize.',
          });
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to call tool: ${errorMessage}`,
        });
      }
    }),

  /**
   * Get all connections health status
   */
  connectGetAllHealth: lobehubSkillAuthProcedure.query(async ({ ctx }) => {
    log('connectGetAllHealth');

    try {
      const response = await ctx.marketSDK.connect.getAllHealth();
      return {
        connections: response.connections || [],
        summary: response.summary,
      };
    } catch (error) {
      log('connectGetAllHealth error: %O', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to get connections health: ${(error as Error).message}`,
      });
    }
  }),

  /**
   * Get authorize URL for a provider
   * This calls the SDK's authorize method which generates a secure authorization URL
   */
  connectGetAuthorizeUrl: lobehubSkillAuthProcedure
    .input(
      z.object({
        provider: z.string(),
        redirectUri: z.string().optional(),
        scopes: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('connectGetAuthorizeUrl: provider=%s', input.provider);

      try {
        const response = await ctx.marketSDK.connect.authorize(input.provider, {
          redirect_uri: input.redirectUri,
          scopes: input.scopes,
        });

        return {
          authorizeUrl: response.authorize_url,
          code: response.code,
          expiresIn: response.expires_in,
        };
      } catch (error) {
        log('connectGetAuthorizeUrl error: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get authorize URL: ${(error as Error).message}`,
        });
      }
    }),

  /**
   * Get connection status for a provider
   */
  connectGetStatus: lobehubSkillAuthProcedure
    .input(z.object({ provider: z.string() }))
    .query(async ({ input, ctx }) => {
      log('connectGetStatus: provider=%s', input.provider);

      try {
        const response = await ctx.marketSDK.connect.getStatus(input.provider);
        return {
          connected: response.connected,
          connection: response.connection,
          icon: (response as any).icon,
          providerName: (response as any).providerName,
        };
      } catch (error) {
        log('connectGetStatus error: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get status: ${(error as Error).message}`,
        });
      }
    }),

  /**
   * List all user connections
   */
  connectListConnections: lobehubSkillBaseProcedure.query(async ({ ctx }) => {
    log('connectListConnections');

    try {
      const response = await listOptionalMarketConnectionsWithTimeout(ctx.marketSDK.connect);
      // Debug logging
      log('connectListConnections raw response: %O', response);
      log('connectListConnections connections: %O', response.connections);
      return {
        connections: response.connections || [],
      };
    } catch (error) {
      log('connectListConnections error: %O', error);
      if (isMarketConnectionsTimeoutError(error)) {
        throw new TRPCError({
          cause: error,
          code: 'TIMEOUT',
          message: `Market connections request timed out after ${MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS / 1000}s`,
        });
      }

      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to list connections: ${(error as Error).message}`,
      });
    }
  }),

  /**
   * List available providers (public, no auth required)
   */
  connectListProviders: lobehubSkillBaseProcedure.query(async ({ ctx }) => {
    log('connectListProviders');

    try {
      const response = await ctx.marketSDK.skills.listProviders();
      return {
        providers: response.providers || [],
      };
    } catch (error) {
      log('connectListProviders error: %O', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to list providers: ${(error as Error).message}`,
      });
    }
  }),

  /**
   * List tools for a provider
   */
  connectListTools: lobehubSkillBaseProcedure
    .input(z.object({ provider: z.string() }))
    .query(async ({ input, ctx }) => {
      log('connectListTools: provider=%s', input.provider);

      try {
        const response = await ctx.marketSDK.skills.listTools(input.provider);
        return {
          provider: input.provider,
          tools: response.tools || [],
        };
      } catch (error) {
        log('connectListTools error: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list tools: ${(error as Error).message}`,
        });
      }
    }),

  /**
   * Refresh token for a provider
   */
  connectRefresh: lobehubSkillAuthProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(async ({ input, ctx }) => {
      log('connectRefresh: provider=%s', input.provider);

      try {
        const response = await ctx.marketSDK.connect.refresh(input.provider);
        return {
          connection: response.connection,
          refreshed: response.refreshed,
        };
      } catch (error) {
        log('connectRefresh error: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to refresh token: ${(error as Error).message}`,
        });
      }
    }),

  /**
   * Revoke connection for a provider
   */
  connectRevoke: lobehubSkillAuthProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(async ({ input, ctx }) => {
      log('connectRevoke: provider=%s', input.provider);

      try {
        await ctx.marketSDK.connect.revoke(input.provider);
        return { success: true };
      } catch (error) {
        log('connectRevoke error: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to revoke connection: ${(error as Error).message}`,
        });
      }
    }),

  /**
   * Export a file from sandbox and upload to S3, then create a persistent file record
   * This combines the previous getExportFileUploadUrl + execInSandbox + createFileRecord flow
   * Returns a permanent /f/:id URL instead of a temporary pre-signed URL
   */
  exportAndUploadFile: sandboxToolProcedure
    .input(exportAndUploadFileSchema)
    .mutation(async ({ input, ctx }) => {
      const { path, filename, topicId } = input;

      log('Exporting and uploading file: %s from path: %s in topic: %s', filename, path, topicId);

      try {
        const sandboxService = createSandboxService({
          fileService: ctx.fileService,
          marketService: ctx.marketService,
          topicId,
          userId: ctx.userId,
        });
        const result = await sandboxService.exportAndUploadFile(path, filename);

        if (!result.success && isSandboxAuthError(result.error)) {
          throwSandboxAuthError();
        }

        return result as ExportAndUploadFileResult;
      } catch (error) {
        log('Error in exportAndUploadFile: %O', error);

        // Re-throw TRPCError as-is
        if (error instanceof TRPCError) {
          throw error;
        }

        const errorMessage = (error as Error).message;

        // Check for authentication errors
        if (
          errorMessage.toLowerCase().includes('invalid_token') ||
          errorMessage.toLowerCase().includes('token expired') ||
          errorMessage.toLowerCase().includes('unauthorized')
        ) {
          throwSandboxAuthError();
        }

        return {
          error: {
            code: 'EXPORT_FAILED',
            message: errorMessage,
            name: (error as Error).name,
            retryable: true,
            stage: 'upload',
          },
          filename,
          success: false,
        } as ExportAndUploadFileResult;
      }
    }),
});
