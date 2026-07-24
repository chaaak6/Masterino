import { describe, expect, it } from 'vitest';

import {
  assertModelProviderEndpointAllowed,
  getAllowedModelProviderOrigins,
} from './endpointPolicy';

describe('model provider endpoint policy', () => {
  it('automatically trusts the configured Aihub proxy origin', () => {
    expect(
      getAllowedModelProviderOrigins({
        AIHUB_PROXY_URL: 'https://aihub.bielcrystal.com/v1',
      }),
    ).toEqual(new Set(['https://aihub.bielcrystal.com']));
  });

  it('accepts explicitly approved origins and normalizes their paths', () => {
    expect(() =>
      assertModelProviderEndpointAllowed({
        baseURL: 'https://models.example.com/v1',
        environment: {
          MODEL_PROVIDER_ALLOWED_ORIGINS:
            'https://models.example.com/admin,http://model-gateway.internal:8080/v1',
        },
        runtimeProvider: 'openai',
      }),
    ).not.toThrow();
  });

  it.each([
    'http://127.0.0.1:11434',
    'http://100.100.100.200/latest/meta-data',
    'https://attacker.example/v1',
    'file:///etc/passwd',
    'https://user:secret@models.example.com/v1',
  ])('rejects an unapproved endpoint: %s', (baseURL) => {
    expect(() =>
      assertModelProviderEndpointAllowed({
        baseURL,
        environment: {
          MODEL_PROVIDER_ALLOWED_ORIGINS: 'https://models.example.com',
        },
        runtimeProvider: 'openai',
      }),
    ).toThrow('Model provider endpoint is not approved');
  });

  it.each(['ollama', 'lmstudio'])(
    'rejects the implicit loopback default for %s',
    (runtimeProvider) => {
      expect(() =>
        assertModelProviderEndpointAllowed({
          environment: {},
          runtimeProvider,
        }),
      ).toThrow('Model provider endpoint is not approved');
    },
  );

  it('allows a provider without a custom endpoint to use its SDK default', () => {
    expect(() =>
      assertModelProviderEndpointAllowed({
        environment: {},
        runtimeProvider: 'openai',
      }),
    ).not.toThrow();
  });
});
