// @vitest-environment node
import type { LobeRuntimeAI } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { GET } from './route';

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

let request: Request;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});

  request = new Request(new URL('https://test.com'), {
    method: 'GET',
  });

  // Default: valid session
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'test-user-id' } as any,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('GET handler', () => {
  describe('error handling', () => {
    it.each([
      new Error('request to http://127.0.0.1:1234/v1/models failed, reason: connect ECONNREFUSED'),
      {
        error: {
          cause: { message: 'connect ECONNREFUSED 127.0.0.1:11434' },
          message: 'Provider request failed',
        },
        errorType: 471,
      },
    ])('should replace model fetch error details with a generic response', async (error) => {
      const mockParams = Promise.resolve({ provider: 'google' });

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockRejectedValue(error),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(response.status).toBe(500);
      expect(responseBody.errorType).toBe(ChatErrorType.InternalServerError);
      expect(responseBody.body).toEqual({
        message: 'Provider unavailable',
        provider: 'google',
      });

      const responseText = JSON.stringify(responseBody);
      expect(responseText).not.toContain('127.0.0.1');
      expect(responseText).not.toContain('ECONNREFUSED');
      expect(responseText).not.toContain('/v1/models');
    });

    it('should also sanitize errors raised while initializing the provider', async () => {
      const mockParams = Promise.resolve({ provider: 'githubcopilot' });

      vi.mocked(initModelRuntimeFromDB).mockRejectedValue({
        error: { message: 'Invalid API key at https://internal-provider.example/v1' },
        errorType: 401,
      });

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(response.status).toBe(500);
      expect(responseBody.errorType).toBe(ChatErrorType.InternalServerError);
      expect(responseBody.body).toEqual({
        message: 'Provider unavailable',
        provider: 'githubcopilot',
      });
      expect(JSON.stringify(responseBody)).not.toContain('internal-provider.example');
    });

    it('should log only a sanitized error classification', async () => {
      const mockParams = Promise.resolve({ provider: 'openai' });
      const sensitiveError = new Error('connect ECONNREFUSED 127.0.0.1:11434');
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockRejectedValue(sensitiveError),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      await GET(request, { params: mockParams });

      expect(console.error).toHaveBeenCalledWith('[models] Provider model listing failed', {
        errorName: 'Error',
        provider: 'openai',
      });
    });
  });

  describe('success cases', () => {
    it('should return model list on success', async () => {
      const mockParams = Promise.resolve({ provider: 'openai' });

      const mockModelList = [
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      ];

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockResolvedValue(mockModelList),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(response.status).toBe(200);
      expect(responseBody).toEqual(mockModelList);
      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
        expect.anything(),
        'test-user-id',
        'openai',
        undefined,
        { allowEnvironmentFallback: false },
      );
    });
  });
});
