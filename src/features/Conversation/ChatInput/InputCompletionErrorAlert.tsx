'use client';

import { Alert, Button, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useBusinessInputCompletionErrorAlert } from '@/business/client/hooks/useBusinessInputCompletionErrorAlert';
import { selectors as chatInputSelectors, useChatInputStore } from '@/features/ChatInput/store';
import type { InputCompletionError } from '@/features/ChatInput/store/initialState';

const InputCompletionErrorAlertContent = memo<{
  inputCompletionError: InputCompletionError;
}>(({ inputCompletionError }) => {
  const { t } = useTranslation('chat');
  const clearInputCompletionError = useChatInputStore((s) => s.clearInputCompletionError);
  const businessAlert = useBusinessInputCompletionErrorAlert({
    error: inputCompletionError,
    onRetry: clearInputCompletionError,
  });

  const action = businessAlert.action ?? (
    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
      <Button size={'small'} type={'primary'} onClick={clearInputCompletionError}>
        {t('input.inputCompletionError.retry')}
      </Button>
      <Link to={'/settings/service-model'}>
        <Button size={'small'}>{t('input.inputCompletionError.settings')}</Button>
      </Link>
    </Flexbox>
  );

  return (
    <>
      <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
        <Alert
          showIcon
          action={action}
          description={businessAlert.description ?? t('input.inputCompletionError.desc')}
          title={t('input.inputCompletionError.title')}
          type={'warning'}
        />
      </Flexbox>
      {businessAlert.extra}
    </>
  );
});

InputCompletionErrorAlertContent.displayName = 'InputCompletionErrorAlertContent';

const InputCompletionErrorAlert = memo(() => {
  const inputCompletionError = useChatInputStore(chatInputSelectors.inputCompletionErrorVisible);

  if (!inputCompletionError) return null;

  return <InputCompletionErrorAlertContent inputCompletionError={inputCompletionError} />;
});

InputCompletionErrorAlert.displayName = 'InputCompletionErrorAlert';

export default InputCompletionErrorAlert;
