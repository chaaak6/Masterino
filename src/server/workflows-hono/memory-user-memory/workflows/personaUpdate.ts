import { type WorkflowContext } from '@upstash/workflow';
import { z } from 'zod';

import { getServerDB } from '@/database/server';
import { isPersonalMemoryEnabled } from '@/server/services/memory/userMemory/access';
import {
  buildUserPersonaJobInput,
  UserPersonaService,
} from '@/server/services/memory/userMemory/persona/service';

const workflowPayloadSchema = z.object({
  userIds: z.array(z.string()).optional(),
});

export const personaUpdateHandler = async (context: WorkflowContext) => {
  const payload = await context.run('memory:pipelines:persona:update-writing:parse-payload', () =>
    workflowPayloadSchema.parse(context.requestPayload || {}),
  );
  const db = await getServerDB();

  const userIds = Array.from(new Set(payload.userIds || [])).filter(Boolean);
  if (userIds.length === 0) {
    throw new Error('No user IDs provided for persona update.');
  }

  const service = new UserPersonaService(db);

  const results = await Promise.all(
    userIds.map(async (userId) =>
      context.run(`memory:pipelines:persona:update-writing:users:${userId}`, async () => {
        if (!(await isPersonalMemoryEnabled({ db, userId }))) {
          return { skipped: true, userId };
        }

        const jobInput = await buildUserPersonaJobInput(db, userId);
        const result = await service.composeWriting({ ...jobInput, userId });
        return {
          diffId: result.diff?.id,
          documentId: result.document.id,
          userId,
          version: result.document.version,
        };
      }),
    ),
  );
  const processedUsers = results.filter((result) => !('skipped' in result)).length;

  return {
    message: 'User persona processed via workflow.',
    processedUsers,
    skippedUsers: userIds.length - processedUsers,
  };
};
