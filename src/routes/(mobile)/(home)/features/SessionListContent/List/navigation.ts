import { GROUP_CHAT_URL, SESSION_CHAT_URL } from '@/const/url';
import { type LobeSessions, LobeSessionType } from '@/types/session';

export interface SessionNavigationTarget {
  href: string;
  targetId: string;
  type: 'agent' | 'group';
}

export const getSessionNavigationTarget = (session: LobeSessions[0]): SessionNavigationTarget => {
  if (session.type === LobeSessionType.Group) {
    return {
      href: GROUP_CHAT_URL(session.id),
      targetId: session.id,
      type: 'group',
    };
  }

  const agentId = (session as any).config?.id || session.id;

  return {
    href: SESSION_CHAT_URL(agentId, true),
    targetId: agentId,
    type: 'agent',
  };
};
