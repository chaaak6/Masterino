import { Flexbox } from '@lobehub/ui';
import { memo, useEffect, useRef } from 'react';

import AttachmentStrip from '@/features/Attachments/AttachmentStrip';
import { fileChatSelectors, useFileStore } from '@/store/file';

import { useAgentId } from '../../hooks/useAgentId';
import { useChatInputStore } from '../../store';
import SelectionItem from './SelectionItem';

const ContextList = memo(() => {
  const agentId = useAgentId();
  const draftKey = useChatInputStore((s) => s.draftKey);
  const prevAgentIdRef = useRef<string | undefined>(undefined);
  const rawSelectionList = useFileStore((s) =>
    fileChatSelectors.chatContextSelections(s, draftKey),
  );
  const clearChatContextSelections = useFileStore((s) => s.clearChatContextSelections);

  // Older inputs without a draft key still clear their shared selection on agent change.
  useEffect(() => {
    if (!draftKey && prevAgentIdRef.current !== undefined && prevAgentIdRef.current !== agentId) {
      clearChatContextSelections();
    }
    prevAgentIdRef.current = agentId;
  }, [agentId, clearChatContextSelections, draftKey]);

  // Filter duplicates based on preview content
  const selectionList = rawSelectionList.filter(
    (item, index, self) => index === self.findIndex((t) => t.preview === item.preview),
  );

  return (
    <Flexbox gap={4}>
      <AttachmentStrip />
      {selectionList.length > 0 && (
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
