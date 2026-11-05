import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { validateRegenerationImages } from '@/features/Attachments/validateMessageImages';

import {
  messageStateSelectors,
  useConversationStore,
  useConversationStoreApi,
} from '../../../../store';
import { defineAction } from '../defineAction';

export const regenerateAction = defineAction({
  key: 'regenerate',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');
    const storeApi = useConversationStoreApi();
    const isRegenerating = useConversationStore(
      messageStateSelectors.isMessageRegenerating(ctx.id),
    );
    const [regenerateUserMessage, regenerateAssistantMessage, deleteMessage] = useConversationStore(
      (s) => [s.regenerateUserMessage, s.regenerateAssistantMessage, s.deleteMessage],
    );

    return useMemo(
      () => ({
        disabled: isRegenerating,
        handleClick: () => {
          if (!validateRegenerationImages(storeApi.getState().displayMessages, ctx.id)) return;
          if (ctx.role === 'user') {
            regenerateUserMessage(ctx.id);
            if (ctx.data.error) deleteMessage(ctx.id);
          } else {
            regenerateAssistantMessage(ctx.id);
            if (ctx.data.error) deleteMessage(ctx.id);
          }
        },
        icon: RotateCcw,
        key: 'regenerate',
        label: t('regenerate'),
        spin: isRegenerating || undefined,
      }),
      [
        t,
        ctx.id,
        ctx.role,
        ctx.data.error,
        isRegenerating,
        regenerateUserMessage,
        regenerateAssistantMessage,
        deleteMessage,
        storeApi,
      ],
    );
  },
});
