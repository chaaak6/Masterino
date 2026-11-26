import { message } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorModal } from '@/features/EditorModal';

import { useConversationStore } from '../../../store';

export interface EditStateProps {
  content: string;
  editorData?: unknown;
  id: string;
}

const EditState = memo<EditStateProps>(({ id, content, editorData }) => {
  const { t } = useTranslation('error');
  const [toggleMessageEditing, updateMessageContent] = useConversationStore((s) => [
    s.toggleMessageEditing,
    s.modifyMessageContent,
  ]);

  return (
    <EditorModal
      editorData={editorData}
      open={!!id}
      value={content ? String(content) : ''}
      onCancel={() => {
        toggleMessageEditing(id, false);
      }}
      onConfirm={async (value, newEditorData) => {
        if (!id) return;
        try {
          await updateMessageContent(id, value, newEditorData as Record<string, any> | undefined);
          toggleMessageEditing(id, false);
        } catch (error) {
          console.error('[EditState] message save failed', error);
          message.error(t('unknownError.title'));
        }
      }}
    />
  );
});

export default EditState;
