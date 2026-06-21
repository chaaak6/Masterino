import { describe, expect, it } from 'vitest';

import { LobeSessionType } from '@/types/session';

import { getSessionNavigationTarget } from './navigation';

describe('getSessionNavigationTarget', () => {
  it('uses the agent chat URL for agent sessions', () => {
    expect(
      getSessionNavigationTarget({
        config: { id: 'agent-1' },
        id: 'session-1',
        type: LobeSessionType.Agent,
      } as any),
    ).toEqual({
      href: '/agent/agent-1',
      targetId: 'agent-1',
      type: 'agent',
    });
  });

  it('uses the group chat URL for group sessions', () => {
    expect(
      getSessionNavigationTarget({
        id: 'group-1',
        type: LobeSessionType.Group,
      } as any),
    ).toEqual({
      href: '/group/group-1',
      targetId: 'group-1',
      type: 'group',
    });
  });
});
