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

  it('filters Aihub models by their raw model id text', () => {
    const { result } = renderHook(() => useBuildListItems(enabledList, 'byProvider', 'glm-5.1'));

    expect(result.current).toEqual([]);
  });
});
