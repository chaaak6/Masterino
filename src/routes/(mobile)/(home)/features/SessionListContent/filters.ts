import { type LobeAgentSession, type LobeSessions, LobeSessionType } from '@/types/session';

const shouldHideDesktopSession = (session: LobeSessions[0]) =>
  session.type === LobeSessionType.Agent && Boolean((session as LobeAgentSession).config?.virtual);

export const filterSessionsForHomeView = (
  sessions: LobeSessions | undefined,
  isMobile: boolean,
): LobeSessions => {
  if (!sessions) return [];

  if (isMobile) return sessions;

  return sessions.filter((session) => !shouldHideDesktopSession(session));
};
