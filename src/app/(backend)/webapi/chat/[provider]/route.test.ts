// @vitest-environment node
import { type LobeRuntimeAI } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { resetProviderCircuitForTest } from './resilience';
import { POST } from './route';

const mockRecordContextWindowRejection = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: vi.fn().mockImplementation(() => ({
    recordContextWindowRejection: mockRecordContextWindowRejection,
  })),
}));

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
  createTraceOptions: vi.fn().mockReturnValue({}),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

// 模拟请求和响应
let request: Request;
beforeEach(() => {
  resetProviderCircuitForTest();
  request = new Request(new URL('https://test.com'), {
    method: 'POST',
    body: JSON.stringify({ model: 'test-model' }),
  });

  // Default: valid session
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'test-user-id' } as any,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST handler', () => {
  describe('init chat model', () => {
    it('should initialize ModelRuntime correctly with valid session', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });

      const mockChatResponse = new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      await POST(request as unknown as Request, { params: mockParams });

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
        expect.anything(),
        'test-user-id',
        'test-provider',
        undefined,
      );
    });

    it('should return Unauthorized error when no session exists', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      const mockParams = Promise.resolve({ provider: 'test-provider' });

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(401);
    });
  });

  describe('chat', () => {
    it('should correctly handle chat completion with valid payload', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = { message: 'Hello, world!' };
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify(mockChatPayload),
      });

      const mockChatResponse: any = { success: true, message: 'Reply from agent' };
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(request as unknown as Request, { params: mockParams });

      expect(response).toEqual(mockChatResponse);
      expect(mockRuntime.chat).toHaveBeenCalledWith(mockChatPayload, {
        abortSignals: {
          requestSignal: expect.anything(),
          totalSignal: expect.anything(),
        },
        callback: { onError: expect.any(Function) },
        headers: expect.objectContaining({ 'x-request-id': expect.any(String) }),
        metadata: {
          operationId: expect.any(String),
          provider: 'test-provider',
        },
        requestHeaders: { 'X-Request-ID': expect.any(String) },
        user: 'test-user-id',
        signal: expect.anything(),
      });
    });

    it('should return an error response when chat completion fails', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = { message: 'Hello, world!' };
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify(mockChatPayload),
      });

      const mockErrorResponse = {
        errorType: ChatErrorType.InternalServerError,
        error: { errorMessage: 'Something went wrong', errorType: 500 },
        errorMessage: 'Something went wrong',
      };

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockRejectedValue(mockErrorResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(500);
      expect(response.headers.get('x-request-id')).toEqual(expect.any(String));
      expect(await response.json()).toEqual({
        body: {
          errorMessage: 'Something went wrong',
          error: {
            message: 'Something went wrong',
            name: 'Error',
          },
          provider: 'test-provider',
          requestId: expect.any(String),
          traceId: expect.any(String),
        },
        errorType: 500,
      });
    });

    it('persists structured context-window evidence emitted by the provider stream', async () => {
      const mockParams = Promise.resolve({ provider: 'newapi' });
      request = new Request(new URL('https://test.com'), {
        body: JSON.stringify({ messages: [], model: 'company-chat' }),
        method: 'POST',
      });
      mockRecordContextWindowRejection.mockResolvedValueOnce(true);
      const mockChatResponse = new Response('rejected-stream');
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockImplementation(async (_payload, options) => {
          await options?.callback?.onError?.({
            code: 'ExceededContextWindow',
            contextWindowTokens: 32_000,
          });
          return mockChatResponse;
        }),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      await POST(request, { params: mockParams });

      expect(mockRecordContextWindowRejection).toHaveBeenCalledWith({
        contextWindowRejectionTokens: 32_000,
        modelId: 'company-chat',
        providerId: 'newapi',
      });
    });

    it('should retry transient NewAPI failures before a response is returned', async () => {
      const mockParams = Promise.resolve({ provider: 'newapi' });
      const mockChatResponse = new Response('ok');
      const transientError = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi
          .fn()
          .mockRejectedValueOnce(transientError)
          .mockRejectedValueOnce(transientError)
          .mockResolvedValue(mockChatResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(request, { params: mockParams });

      expect(response).toBe(mockChatResponse);
      expect(mockRuntime.chat).toHaveBeenCalledTimes(3);
    });
    it('Given client-owned recovery, Then the server does not multiply the retry budget', async () => {
      request.headers.set('X-Masterino-Client-Recovery', '1');
      const chat = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        new ModelRuntime({ baseURL: 'abc', chat }),
      );
      const response = await POST(request, { params: Promise.resolve({ provider: 'newapi' }) });
      expect(chat).toHaveBeenCalledOnce();
      expect(response.status).toBe(500);
    });

    it('classifies the original wrapped provider error before serialization', async () => {
      request.headers.set('X-Masterino-Client-Recovery', '1');
      const chat = vi.fn().mockRejectedValue({ status: 503, error: { message: 'upstream busy' } });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        new ModelRuntime({ baseURL: 'abc', chat }),
      );
      const response = await POST(request, { params: Promise.resolve({ provider: 'newapi' }) });
      expect((await response.json()).body.retryable).toBe(true);
      expect(chat).toHaveBeenCalledOnce();
    });

    it.each(['2', '0'])(
      'preserves bounded upstream Retry-After %s for client-owned recovery',
      async (retryAfter) => {
        request.headers.set('X-Masterino-Client-Recovery', '1');
        const chat = vi
          .fn()
          .mockRejectedValue({
            status: 429,
            headers: { 'retry-after': retryAfter },
            message: 'rate limited',
          });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
          new ModelRuntime({ baseURL: 'abc', chat }),
        );
        const response = await POST(request, { params: Promise.resolve({ provider: 'newapi' }) });
        const body = await response.json();
        expect(body.body.retryable).toBe(true);
        expect(body.body.retryAfterMs).toBe(Number(retryAfter) * 1000);
        expect(response.headers.get('Retry-After')).toBe(retryAfter);
        expect(chat).toHaveBeenCalledOnce();
      },
    );

    it.each([undefined, '99', 'invalid'])(
      'does not automatically retry quota or unbounded 429: %s',
      async (retryAfter) => {
        request.headers.set('X-Masterino-Client-Recovery', '1');
        const chat = vi
          .fn()
          .mockRejectedValue({
            status: 429,
            headers: { 'retry-after': retryAfter },
            message: 'rate limited',
          });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
          new ModelRuntime({ baseURL: 'abc', chat }),
        );
        const response = await POST(request, { params: Promise.resolve({ provider: 'newapi' }) });
        expect((await response.json()).body.retryable).toBe(false);
        expect(response.headers.has('Retry-After')).toBe(false);
      },
    );

    it('keeps circuit protection active for client-owned recovery', async () => {
      request.headers.set('X-Masterino-Client-Recovery', '1');
      const chat = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNREFUSED' }));
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        new ModelRuntime({ baseURL: 'abc', chat }),
      );
      for (let attempt = 0; attempt < 6; attempt++) {
        const response = await POST(request, { params: Promise.resolve({ provider: 'newapi' }) });
        const body = await response.json();
        expect(body.body.retryable).toBe(true);
      }
      expect(chat).toHaveBeenCalledTimes(5);
    });

    it('should not retry NewAPI authentication failures', async () => {
      const mockParams = Promise.resolve({ provider: 'newapi' });
      const authError = Object.assign(new Error('Invalid API key'), { status: 401 });
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockRejectedValue(authError),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(500);
      expect(mockRuntime.chat).toHaveBeenCalledOnce();
      expect(await response.json()).toEqual({
        body: expect.objectContaining({
          error: expect.objectContaining({ message: 'Invalid API key', status: 401 }),
          requestId: expect.any(String),
        }),
        errorType: 500,
      });
    });
  });
});
