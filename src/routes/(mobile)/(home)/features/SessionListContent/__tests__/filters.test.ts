import { describe, expect, it } from 'vitest';

import { LobeSessionType } from '@/types/session';

import { filterSessionsForHomeView } from '../filters';

describe('filterSessionsForHomeView', () => {
  it('keeps group sessions visible on mobile', () => {
    const sessions = [
      { id: 'agent-session', type: LobeSessionType.Agent },
      { id: 'group-session', type: LobeSessionType.Group },
    ] as any;

    expect(filterSessionsForHomeView(sessions, true).map((item: any) => item.id)).toEqual([
      'agent-session',
      'group-session',
    ]);
  });

  it('still hides virtual agents on desktop', () => {
    const sessions = [
      { id: 'regular-agent', type: LobeSessionType.Agent },
      { config: { virtual: true }, id: 'virtual-agent', type: LobeSessionType.Agent },
      { id: 'group-session', type: LobeSessionType.Group },
    ] as any;

    expect(filterSessionsForHomeView(sessions, false).map((item: any) => item.id)).toEqual([
      'regular-agent',
      'group-session',
    ]);
  });
});
