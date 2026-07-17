'use client';

import { Alert, Center, Empty, Flexbox, Skeleton } from '@lobehub/ui';
import { FileCode2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineHtmlPreview } from '@/components/HtmlPreview';
import { useClientDataSWR } from '@/libs/swr';
import { documentService } from '@/services/document';
import { documentSWRKeys } from '@/services/document/swrKeys';

interface HtmlDocumentPreviewProps {
  documentId: string;
}

const HtmlDocumentPreview = memo<HtmlDocumentPreviewProps>(({ documentId }) => {
  const { t } = useTranslation('components');
  const { data, error, isLoading } = useClientDataSWR(documentSWRKeys.editor(documentId), () =>
    documentService.getDocumentById(documentId),
  );

  if (isLoading) {
    return (
      <Flexbox flex={1} style={{ padding: 24 }} width={'100%'}>
        <Skeleton active paragraph={{ rows: 10 }} />
      </Flexbox>
    );
  }

  if (error || !data) {
    return (
      <Flexbox flex={1} style={{ padding: 24 }} width={'100%'}>
        <Alert message={t('HtmlPreview.documentLoadFailed')} type={'error'} />
      </Flexbox>
    );
  }

  if (!data.content?.trim()) {
    return (
      <Center flex={1} width={'100%'}>
        <Empty description={t('HtmlPreview.emptyDocument')} icon={FileCode2} />
      </Center>
    );
  }

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0 }} width={'100%'}>
      <InlineHtmlPreview content={data.content} />
    </Flexbox>
  );
});

HtmlDocumentPreview.displayName = 'HtmlDocumentPreview';

export default HtmlDocumentPreview;
