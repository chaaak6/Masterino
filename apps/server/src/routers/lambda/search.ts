import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { SearchRepo } from '@/database/repositories/search';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DiscoverService } from '@/server/services/discover';
import { isPersonalMemoryEnabled } from '@/server/services/memory/userMemory/access';

/**
 * Calculate relevance score for marketplace items
 * 1 = exact match, 2 = prefix match, 3 = contains match
 */
function calculateMarketplaceRelevance(query: string, title: string): number {
  const lowerQuery = query.toLowerCase().trim();
  const lowerTitle = title.toLowerCase();

  if (lowerTitle === lowerQuery) return 1;
  if (lowerTitle.startsWith(lowerQuery)) return 2;
  if (lowerTitle.includes(lowerQuery)) return 3;
  return 4;
}

const searchProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      discoverService: new DiscoverService({ accessToken: ctx.marketAccessToken }),
      searchRepo: new SearchRepo(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

/**
 * The unified search router for all entities in the database.
 *
 * Can specify the type of entity to search for.
 */
export const searchRouter = router({
  query: searchProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        limitPerType: z.number().optional(),
        locale: z.string().optional(),
        offset: z.number().optional(),
        query: z.string(),
        type: z
          .enum([
            'agent',
            'chatGroup',
            'topic',
            'file',
            'folder',
            'message',
            'page',
            'memory',
            'mcp',
            'plugin',
            'communityAgent',
            'knowledgeBase',
          ])
          .optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { query, type, limitPerType = 5, locale } = input;

      // Early return for empty query
      if (!query || query.trim() === '') return [];

      const maySearchMemory = !type || type === 'memory';
      let memoryEnabled = false;
      if (maySearchMemory) {
        try {
          memoryEnabled = await isPersonalMemoryEnabled({
            db: ctx.serverDB,
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
          });
        } catch (error) {
          // General search should remain available when the memory gate cannot
          // be evaluated, but memory itself must fail closed.
          console.error('[search] failed to evaluate personal memory access', error);
        }
      }

      // A direct memory filter must not query or reveal saved memories unless
      // the runtime rollout and explicit personal-space consent are both active.
      if (type === 'memory' && !memoryEnabled) return [];

      // Build search promises based on type filter
      const searchPromises: Promise<any>[] = [];

      // Database searches (agent, topic, file, folder, message, page, memory)
      if (
        !type ||
        [
          'agent',
          'chatGroup',
          'topic',
          'file',
          'folder',
          'message',
          'page',
          'memory',
          'knowledgeBase',
        ].includes(type)
      ) {
        searchPromises.push(ctx.searchRepo.search({ ...input, includeMemory: memoryEnabled }));
      }

      // Marketplace searches (mcp, plugin)
      if (!type || type === 'mcp') {
        searchPromises.push(
          ctx.discoverService
            .getMcpList({
              locale,
              pageSize: limitPerType,
              q: query,
            })
            .then((response) =>
              response.items.slice(0, limitPerType).map((item: any) => ({
                author:
                  typeof item.author === 'string' ? item.author : item.author?.name || 'Unknown',
                avatar: item.avatar || item.icon || null,
                category: item.category || null,
                connectionType: item.connectionType || null,
                createdAt: new Date(item.createdAt || Date.now()),
                description: item.description || null,
                id: item.identifier,
                identifier: item.identifier,
                installCount: item.installCount || null,
                isFeatured: item.isFeatured || null,
                isValidated: item.isValidated || null,
                relevance: calculateMarketplaceRelevance(
                  query,
                  (item.name || item.title || item.identifier) as string,
                ),
                tags: item.tags || null,
                title: (item.name || item.title || item.identifier) as string,
                type: 'mcp' as const,
                updatedAt: new Date(item.updatedAt || Date.now()),
              })),
            )
            .catch(() => []),
        );
      }

      if (!type || type === 'plugin') {
        searchPromises.push(
          ctx.discoverService
            .getPluginList({
              locale,
              pageSize: limitPerType,
              q: query,
            })
            .then((response) =>
              response.items.slice(0, limitPerType).map((item: any) => ({
                author:
                  typeof item.author === 'string' ? item.author : item.author?.name || 'Unknown',
                avatar: item.avatar || null,
                category: item.category || null,
                createdAt: new Date(item.createdAt || Date.now()),
                description: item.description || null,
                id: item.identifier,
                identifier: item.identifier,
                relevance: calculateMarketplaceRelevance(
                  query,
                  (item.title || item.identifier) as string,
                ),
                tags: item.tags || null,
                title: (item.title || item.identifier) as string,
                type: 'plugin' as const,
                updatedAt: new Date(item.updatedAt || Date.now()),
              })),
            )
            .catch(() => []),
        );
      }

      if (!type || type === 'communityAgent') {
        searchPromises.push(
          ctx.discoverService
            .getAssistantList({
              includeAgentGroup: true,
              locale,
              pageSize: limitPerType,
              q: query,
            })
            .then((response) =>
              response.items.slice(0, limitPerType).map((item: any) => ({
                author:
                  typeof item.author === 'string' ? item.author : item.author?.name || 'Unknown',
                avatar: item.avatar || null,
                createdAt: new Date(item.createdAt || Date.now()),
                description: item.description || null,
                homepage: item.homepage || null,
                id: item.identifier,
                identifier: item.identifier,
                relevance: calculateMarketplaceRelevance(
                  query,
                  (item.title || item.identifier) as string,
                ),
                tags: item.tags || null,
                title: (item.title || item.identifier) as string,
                type: 'communityAgent' as const,
                updatedAt: new Date(item.updatedAt || Date.now()),
              })),
            )
            .catch(() => []),
        );
      }

      // Execute searches in parallel and merge results
      const results = await Promise.all(searchPromises);

      // Results arrive pre-ordered per type (DB types from SearchRepo with
      // topics/messages by recency, marketplace types from the discover service).
      // The command palette groups results by type, so we keep each source's order
      // instead of re-sorting the merged list by relevance.
      // Defense in depth: the repository also skips the memory SQL query when
      // includeMemory is false, but never trust an alternate search source to
      // preserve that privacy boundary.
      return results.flat().filter((result) => memoryEnabled || result?.type !== 'memory');
    }),
});
