import { Flexbox, Text } from '@lobehub/ui';
import { Button, Modal } from '@lobehub/ui/base-ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { useAttachmentScope } from '@/features/ChatInput/hooks/useAttachmentScope';
import { useDesktopDownload } from '@/features/DesktopDownload';
import { useFileStore } from '@/store/file';
import { getChatAttachmentDraft } from '@/store/file/slices/chat/drafts';
import { formatSize } from '@/utils/format';

const AttachmentSupport = memo(() => {
  const { t } = useTranslation('chat');
  const scope = useAttachmentScope();
  const [issues, files, shown, markShown, dismiss] = useFileStore((s) => [
    getChatAttachmentDraft(s, scope).chatAttachmentIssues,
    getChatAttachmentDraft(s, scope).chatUploadFileList,
    getChatAttachmentDraft(s, scope).chatAttachmentNoticeShown,
    s.markChatAttachmentNoticeShown,
    s.dismissChatAttachmentIssues,
  ]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const { disabled, download, loading } = useDesktopDownload();
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const limited =
    !isDesktop &&
    (issues.some((item) => item.web && ['web-size', 'unsupported-format'].includes(item.reason)) ||
      files.some(
        (item) =>
          item.status === 'error' &&
          ['web-size', 'unsupported-format'].includes(item.attachmentError || ''),
      ));
  const reasons = [
    ...new Set([
      ...issues.filter((item) => item.web).map((item) => item.reason),
      ...files.filter((item) => item.status === 'error').map((item) => item.attachmentError),
    ]),
  ].filter((reason) => reason === 'web-size' || reason === 'unsupported-format');
  const hasXlsm =
    issues.some((item) => item.name.toLowerCase().endsWith('.xlsm')) ||
    files.some((item) => item.status === 'error' && item.file.name.toLowerCase().endsWith('.xlsm'));
  useEffect(() => {
    if (limited && !shown) {
      markShown(scope);
      setOpen(true);
    }
  }, [limited, shown, markShown, scope]);
  return (
    <>
      {issues.length > 0 && (
        <Flexbox gap={6} role="alert" style={{ fontSize: 12, paddingBlock: 8 }}>
          <Text strong>{t('attachments.notAdded', { count: issues.length })}</Text>
          <Flexbox gap={4} style={{ maxHeight: 110, overflowY: 'auto' }}>
            {issues.map((issue) => (
              <div key={issue.id}>
                <Text title={`${issue.name} · ${issue.size.toLocaleString()} bytes`}>
                  {issue.name} · {formatSize(issue.size)} ({issue.size.toLocaleString()} B)
                </Text>
                <Text type="secondary"> · {t(`attachments.reason.${issue.reason}`)}</Text>
                {issue.reason === 'unsupported-format' &&
                  issue.name.toLowerCase().endsWith('.xlsm') && (
                    <Text type="secondary"> {t('attachments.xlsmAdvice')}</Text>
                  )}
              </div>
            ))}
          </Flexbox>
          <Flexbox horizontal gap={8} wrap="wrap">
            <Button size="small" onClick={() => dismiss(scope)}>
              {t('attachments.dismissRejected')}
            </Button>
            {limited && !disabled && (
              <Button size="small" onClick={() => setOpen(true)}>
                {t('attachments.useDesktop')}
              </Button>
            )}
          </Flexbox>
        </Flexbox>
      )}
      {limited && issues.length === 0 && !disabled && (
        <Button size="small" style={{ alignSelf: 'start' }} onClick={() => setOpen(true)}>
          {t('attachments.useDesktop')}
        </Button>
      )}
      <Modal
        destroyOnHidden
        footer={null}
        open={open && !isDesktop}
        title={t('attachments.desktopTitle')}
        width={460}
        onCancel={() => setOpen(false)}
      >
        <Flexbox gap={16}>
          {reasons.map((reason) => (
            <Text key={reason}>{t(`attachments.reason.${reason}`)}</Text>
          ))}
          {hasXlsm && <Text>{t('attachments.xlsmAdvice')}</Text>}
          <Text type="secondary">{t('attachments.reselectLocal')}</Text>
          {mobile ? (
            <Flexbox gap={8}>
              <Text>{t('attachments.onComputer')}</Text>
              <Text style={{ overflowWrap: 'anywhere' }}>{window.location.origin}/</Text>
              {!disabled && (
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${window.location.origin}/`);
                      setCopied(true);
                      setCopyError(false);
                    } catch {
                      setCopied(false);
                      setCopyError(true);
                    }
                  }}
                >
                  {t(copied ? 'attachments.copied' : 'attachments.copyLink')}
                </Button>
              )}
              {copyError && <Text role="alert">{t('attachments.copyFailed')}</Text>}
            </Flexbox>
          ) : (
            !disabled && (
              <Button
                loading={loading}
                type="primary"
                onClick={() => {
                  setOpen(false);
                  void download();
                }}
              >
                {t('attachments.downloadDesktop')}
              </Button>
            )
          )}
          <Button onClick={() => setOpen(false)}>{t('attachments.continueWeb')}</Button>
        </Flexbox>
      </Modal>
    </>
  );
});
export default AttachmentSupport;
