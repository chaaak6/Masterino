import { TraceEventType } from '@lobechat/types';
import { after } from 'next/server';
import { z } from 'zod';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { TraceClient } from '@/libs/traces';
import { type TraceEventBasePayload, type TraceEventPayloads } from '@/types/trace';

const MAX_TRACE_REQUEST_BYTES = 32 * 1024;
const MAX_TRACE_CONTENT_LENGTH = 20 * 1024;

const traceIdSchema = z.string().trim().min(1).max(128);
const traceContentSchema = z.string().max(MAX_TRACE_CONTENT_LENGTH);
const traceBaseSchema = {
  content: traceContentSchema,
  observationId: z.string().trim().min(1).max(128).optional(),
  traceId: traceIdSchema,
};
const traceRequestSchema = z.discriminatedUnion('eventType', [
  z
    .object({
      ...traceBaseSchema,
      eventType: z.literal(TraceEventType.ModifyMessage),
      nextContent: traceContentSchema,
    })
    .strict(),
  z
    .object({
      ...traceBaseSchema,
      eventType: z.literal(TraceEventType.DeleteAndRegenerateMessage),
    })
    .strict(),
  z
    .object({
      ...traceBaseSchema,
      eventType: z.literal(TraceEventType.RegenerateMessage),
    })
    .strict(),
  z
    .object({
      ...traceBaseSchema,
      eventType: z.literal(TraceEventType.CopyMessage),
    })
    .strict(),
]);

class TraceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TraceRequestError';
  }
}

const readRequestTextWithLimit = async (req: Request) => {
  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_TRACE_REQUEST_BYTES) {
      throw new TraceRequestError('Trace request is too large', 413);
    }
  }

  if (!req.body) throw new TraceRequestError('Trace request body is required', 400);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalLength += value.byteLength;
    if (totalLength > MAX_TRACE_REQUEST_BYTES) {
      void reader.cancel();
      throw new TraceRequestError('Trace request is too large', 413);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
};

const parseTraceRequest = async (req: Request) => {
  let rawData: unknown;
  try {
    rawData = JSON.parse(await readRequestTextWithLimit(req));
  } catch (error) {
    if (error instanceof TraceRequestError) throw error;
    throw new TraceRequestError('Trace request must contain valid JSON', 400);
  }

  const parsed = traceRequestSchema.safeParse(rawData);
  if (!parsed.success) throw new TraceRequestError('Trace request payload is invalid', 400);

  return parsed.data as TraceEventPayloads & TraceEventBasePayload;
};

const createTraceRequestErrorResponse = (error: TraceRequestError) =>
  Response.json({ error: error.message }, { status: error.status });

export const POST = checkAuth(async (req: Request) => {
  type RequestData = TraceEventPayloads & TraceEventBasePayload;
  let data: RequestData;
  try {
    data = await parseTraceRequest(req);
  } catch (error) {
    if (error instanceof TraceRequestError) return createTraceRequestErrorResponse(error);
    throw error;
  }

  const { traceId, eventType } = data;

  const traceClient = new TraceClient();

  const eventClient = traceClient.createEvent(traceId);

  switch (eventType) {
    case TraceEventType.ModifyMessage: {
      eventClient?.modifyMessage(data);
      break;
    }

    case TraceEventType.DeleteAndRegenerateMessage: {
      eventClient?.deleteAndRegenerateMessage(data);
      break;
    }

    case TraceEventType.RegenerateMessage: {
      eventClient?.regenerateMessage(data);
      break;
    }

    case TraceEventType.CopyMessage: {
      eventClient?.copyMessage(data);
      break;
    }
  }

  after(async () => {
    await traceClient.shutdownAsync();
  });

  return new Response(undefined, { status: 201 });
});
