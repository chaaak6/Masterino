import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { isPersonalMemoryEnabled } from '@/server/services/memory/userMemory/access';
import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  memoryExtractionPayloadSchema,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

export const POST = async (req: Request) => {
  const { webhook, upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

  if (webhook.headers && Object.keys(webhook.headers).length > 0) {
    for (const [key, value] of Object.entries(webhook.headers)) {
      const headerValue = req.headers.get(key);
      if (headerValue !== value) {
        return NextResponse.json(
          { error: `Unauthorized: Missing or invalid header '${key}'` },
          { status: 403 },
        );
      }
    }
  }

  try {
    const json = await req.json();
    const origin = new URL(req.url).origin;

    const payload = memoryExtractionPayloadSchema.parse({
      ...json,
      baseUrl: json.baseUrl || origin,
    });
    if (payload.fromDate && payload.toDate && payload.fromDate > payload.toDate) {
      return NextResponse.json(
        { error: '`fromDate` cannot be later than `toDate`' },
        { status: 400 },
      );
    }

    const params = normalizeMemoryExtractionPayload(payload, origin);
    if (params.workspaceId) {
      return NextResponse.json(
        { error: 'Memory extraction is only available in personal space' },
        { status: 403 },
      );
    }

    let enabledParams = params;
    if (params.userIds.length > 0) {
      const db = await getServerDB();
      const enabledChecks = await Promise.all(
        params.userIds.map(async (userId) => ({
          enabled: await isPersonalMemoryEnabled({ db, userId }),
          userId,
        })),
      );
      const enabledUserIds = enabledChecks
        .filter((item) => item.enabled)
        .map((item) => item.userId);

      if (enabledUserIds.length === 0) {
        return NextResponse.json(
          { error: 'Memory is not enabled for any requested user' },
          { status: 403 },
        );
      }

      enabledParams = { ...params, userIds: enabledUserIds };
    }

    if (enabledParams.mode === 'workflow') {
      const { workflowRunId } = await MemoryExtractionWorkflowService.triggerProcessUsers(
        buildWorkflowPayloadInput(enabledParams),
        { extraHeaders: upstashWorkflowExtraHeaders },
      );

      return NextResponse.json(
        { message: 'Memory extraction scheduled via workflow.', workflowRunId },
        { status: 202 },
      );
    }

    const executor = await MemoryExtractionExecutor.create();
    const result = await executor.runDirect(enabledParams);

    return NextResponse.json(
      { message: 'Memory extraction executed via webhook.', result },
      { status: 200 },
    );
  } catch (error) {
    console.error('[memory-extraction] failed', error);

    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
