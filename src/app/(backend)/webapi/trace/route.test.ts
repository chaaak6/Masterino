// @vitest-environment node
import { TraceEventType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';

import { POST } from './route';

const eventClient = {
  copyMessage: vi.fn(),
  deleteAndRegenerateMessage: vi.fn(),
  modifyMessage: vi.fn(),
  regenerateMessage: vi.fn(),
};
const traceClient = {
  createEvent: vi.fn(() => eventClient),
  shutdownAsync: vi.fn(),
};

vi.mock('next/server', () => ({
  after: vi.fn((callback: () => unknown) => callback()),
}));

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('@/libs/traces', () => ({
  TraceClient: vi.fn(() => traceClient),
}));

const createRequest = (body: unknown) =>
  new Request('https://app.test/webapi/trace', {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

const validPayload = {
  content: 'hello',
  eventType: TraceEventType.CopyMessage,
  traceId: 'trace-1',
};

beforeEach(() => {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'user-1' } as any,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /webapi/trace', () => {
  it('rejects unauthenticated trace injection', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const response = await POST(createRequest(validPayload), { params: Promise.resolve({}) });

    expect(response.status).toBe(401);
    expect(traceClient.createEvent).not.toHaveBeenCalled();
  });

  it('accepts a valid authenticated trace event', async () => {
    const response = await POST(createRequest(validPayload), { params: Promise.resolve({}) });

    expect(response.status).toBe(201);
    expect(traceClient.createEvent).toHaveBeenCalledWith('trace-1');
    expect(eventClient.copyMessage).toHaveBeenCalledWith(validPayload);
  });

  it('rejects unknown fields and unsupported event types', async () => {
    const response = await POST(
      createRequest({ ...validPayload, eventType: 'Injected Event', unexpected: 'data' }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(400);
    expect(traceClient.createEvent).not.toHaveBeenCalled();
  });

  it('requires nextContent only for modify events', async () => {
    const response = await POST(
      createRequest({
        content: 'before',
        eventType: TraceEventType.ModifyMessage,
        traceId: 'trace-1',
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(400);
    expect(eventClient.modifyMessage).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const response = await POST(createRequest('{not-json'), { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Trace request must contain valid JSON',
    });
  });

  it('rejects request bodies larger than 32 KiB', async () => {
    const response = await POST(createRequest('x'.repeat(32 * 1024 + 1)), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(413);
    expect(traceClient.createEvent).not.toHaveBeenCalled();
  });
});
