import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import MarkdownMessage from '@/features/Conversation/Markdown';
import { cleanSpeakerTag } from '@/store/chat/utils/cleanSpeakerTag';
import { type UIChatMessage } from '@/types/index';

import { useMarkdown } from '../useMarkdown';
import CollapsibleContent from './CollapsibleContent';
import PageSelections from './PageSelections';
import RichTextMessage from './RichTextMessage';
import VideoFileListViewer from './VideoFileListViewer';

const UserMessageContent = memo<UIChatMessage>(
  ({ id, content, editorData, videoList, metadata }) => {
    const markdownProps = useMarkdown(id);
    const pageSelections = metadata?.pageSelections;
    const displayContent = useMemo(() => (content ? cleanSpeakerTag(content) : content), [content]);

    const hasEditorData =
      editorData && typeof editorData === 'object' && Object.keys(editorData).length > 0;

    const textBody = hasEditorData ? (
      <RichTextMessage editorState={editorData} />
    ) : (
      displayContent && <MarkdownMessage {...markdownProps}>{displayContent}</MarkdownMessage>
    );

    return (
      <Flexbox gap={8} id={id}>
        {pageSelections && pageSelections.length > 0 && (
          <PageSelections selections={pageSelections} />
        )}
        {textBody && <CollapsibleContent>{textBody}</CollapsibleContent>}
        {videoList && videoList?.length > 0 && <VideoFileListViewer items={videoList} />}
      </Flexbox>
    );
  },
);

export default UserMessageContent;
