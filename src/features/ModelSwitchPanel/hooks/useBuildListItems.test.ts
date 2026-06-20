import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

import { useBuildListItems } from './useBuildListItems';

describe('useBuildListItems', () => {
  const enabledList: EnabledProviderWithModels[] = [
    {
      children: [
        {
          abilities: { functionCall: true, reasoning: true, search: true },
          displayName: 'glm5-5.1',
          id: 'glm5-5.1',
        },
      ],
      id: 'newapi',
      name: 'Aihub',
      source: 'builtin',
    },
  ];

  it('matches Aihub GLM aliases when filtering by model id', () => {
    const { result } = renderHook(() => useBuildListItems(enabledList, 'byProvider', 'glm-5.1'));

    expect(result.current).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: expect.objectContaining({ id: 'glm5-5.1' }),
          provider: expect.objectContaining({ id: 'newapi' }),
          type: 'provider-model-item',
        }),
      ]),
    );
  });
});
