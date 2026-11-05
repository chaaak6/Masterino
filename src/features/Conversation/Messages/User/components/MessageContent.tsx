import { normalizeMessageAttachments } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import MarkdownMessage from '@/features/Conversation/Markdown';
import { cleanSpeakerTag } from '@/store/chat/utils/cleanSpeakerTag';
import { type UIChatMessage } from '@/types/index';

import { useMarkdown } from '../useMarkdown';
import CollapsibleContent from './CollapsibleContent';
import FileListViewer from './FileListViewer';
import ImageFileListViewer from './ImageFileListViewer';
import LocalAttachmentItem from './LocalAttachmentItem';
import MessageImageGallery from './MessageImageGallery';
import PageSelections from './PageSelections';
import RichTextMessage from './RichTextMessage';
import VideoFileListViewer from './VideoFileListViewer';

const UserMessageContent = memo<UIChatMessage>(
  ({ id, content, editorData, imageList, videoList, fileList, metadata, attachments, topicId }) => {
    const allAttachments = normalizeMessageAttachments({
      attachments,
      fileList,
      imageList,
    });
    const localAttachments = allAttachments.filter((item) => item.source === 'local');
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
        {!localAttachments.some((item) => item.mime.startsWith('image/')) &&
          imageList &&
          imageList.length > 0 && <ImageFileListViewer items={imageList} />}
        {videoList && videoList?.length > 0 && <VideoFileListViewer items={videoList} />}
        {localAttachments.some((item) => item.mime.startsWith('image/')) && (
          <MessageImageGallery
            items={allAttachments.filter((item) => item.mime.startsWith('image/'))}
            messageId={id}
            topicId={topicId}
            uploadedImages={imageList || []}
          />
        )}
        {localAttachments
          .filter((item) => !item.mime.startsWith('image/'))
          .map((item) => (
            <LocalAttachmentItem
              attachment={item}
              key={item.attachmentId}
              messageId={id}
              topicId={topicId}
            />
          ))}
        {fileList && fileList?.length > 0 && <FileListViewer items={fileList} />}
      </Flexbox>
    );
  },
);

export default UserMessageContent;
