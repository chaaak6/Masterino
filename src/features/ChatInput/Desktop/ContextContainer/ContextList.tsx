import { Flexbox } from '@lobehub/ui';
import { memo, useEffect, useRef } from 'react';

import AttachmentStrip from '@/features/Attachments/AttachmentStrip';
import { fileChatSelectors, useFileStore } from '@/store/file';

import { useAgentId } from '../../hooks/useAgentId';
import SelectionItem from './SelectionItem';

const ContextList = memo(() => {
  const agentId = useAgentId();
  const prevAgentIdRef = useRef<string | undefined>(undefined);
  const rawSelectionList = useFileStore(fileChatSelectors.chatContextSelections);
  const showSelectionList = useFileStore(fileChatSelectors.chatContextSelectionHasItem);
  const clearChatContextSelections = useFileStore((s) => s.clearChatContextSelections);

  // Clear selections only when agentId changes (not on initial mount)
  useEffect(() => {
    if (prevAgentIdRef.current !== undefined && prevAgentIdRef.current !== agentId) {
      clearChatContextSelections();
    }
    prevAgentIdRef.current = agentId;
  }, [agentId, clearChatContextSelections]);

  // Filter duplicates based on preview content
  const selectionList = rawSelectionList.filter(
    (item, index, self) => index === self.findIndex((t) => t.preview === item.preview),
  );

  return (
    <Flexbox gap={4}>
      <AttachmentStrip />
      {showSelectionList && selectionList.length > 0 && (
        <Flexbox horizontal gap={4} wrap="wrap">
          {selectionList.map((item) => (
            <SelectionItem key={item.id} {...item} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default ContextList;
