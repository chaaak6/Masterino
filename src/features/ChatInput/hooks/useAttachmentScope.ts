import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatInputStore } from '../store';
import { useAgentId } from './useAgentId';

export const useAttachmentScope = () => {
  const agentId = useAgentId();
  const [draftKey, topicId] = useChatInputStore((s) => [s.draftKey, s.topicId]);
  return draftKey || messageMapKey({ agentId, topicId });
};
