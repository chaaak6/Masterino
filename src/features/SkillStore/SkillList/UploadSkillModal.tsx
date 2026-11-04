'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { SKILL_SOURCE_MAX_BYTES } from '@lobechat/skill-package';
import { Alert, Button, Flexbox, Icon } from '@lobehub/ui';
import { App, Modal, Spin, Typography, Upload } from 'antd';
import { sha256 } from 'js-sha256';
import { ArrowLeftRight, InboxIcon, Sparkles, Upload as UploadIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SubmitSkillModal from '@/features/SkillPublishing/SubmitSkillModal';
import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client/lambda';
import { UPLOAD_NETWORK_ERROR, uploadService } from '@/services/upload';
import { useToolStore } from '@/store/tool';

interface UploadSkillModalProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const UploadSkillModal = memo<UploadSkillModalProps>(({ open, onOpenChange }) => {
  const { t } = useTranslation(['setting', 'common', 'discover']);
  const { message } = App.useApp();
  const importAgentSkillFromZip = useToolStore((s) => s.importAgentSkillFromZip);
  const [importedId, setImportedId] = useState<string>();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { allowed: canCreate } = usePermission('create_content');

  const handleClose = () => {
    onOpenChange(false);
    setError(null);
    setImportedId(undefined);
    setSubmitOpen(false);
  };

  const handleUploadFile = async (file: File) => {
    if (!canCreate) return;
    if (file.size > SKILL_SOURCE_MAX_BYTES) {
      setError(t('agentSkillModal.upload.sizeLimit', { size: 64 }));
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const { data: metadata } = await uploadService.uploadFileToS3(file, {
        directory: 'skills',
      });

      const hash = sha256(await file.arrayBuffer());

      const result = await lambdaClient.file.createFile.mutate({
        fileType: file.type || 'application/zip',
        hash,
        metadata: {},
        name: file.name,
        size: file.size,
        url: metadata.path,
      });

      const imported = await importAgentSkillFromZip({ zipFileId: result.id });
      if (!imported) throw new Error(t('unknownError', { ns: 'common' }));
      setImportedId(imported.skill.id);
      message.success(t('agentSkillModal.importSuccess'));
    } catch (err: any) {
      const detail = err?.message || String(err);
      setError(
        detail === UPLOAD_NETWORK_ERROR || detail === 'Failed to fetch'
          ? t('skillStore.networkError')
          : detail.startsWith('Invalid skill manifest:')
            ? t('publishing.invalidManifest', { ns: 'discover' })
            : detail,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Modal
        destroyOnClose
        closable={!loading}
        footer={null}
        maskClosable={!loading}
        open={open && !submitOpen}
        title={null}
        width={480}
        onCancel={handleClose}
      >
        <Flexbox align="center" gap={16} padding={'16px 0'}>
          <Flexbox horizontal align="center" gap={8}>
            <Icon icon={UploadIcon} size={28} />
            <Icon
              icon={ArrowLeftRight}
              size={16}
              style={{ color: 'var(--ant-color-text-tertiary)' }}
            />
            <Icon icon={Sparkles} size={28} />
          </Flexbox>

          <Flexbox align="center" gap={4}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t('agentSkillModal.upload.title')}
            </Typography.Title>
            <Typography.Text type="secondary">{t('agentSkillModal.upload.desc')}</Typography.Text>
          </Flexbox>
        </Flexbox>

        <Flexbox gap={16}>
          {error && (
            <Alert showIcon title={t('agentSkillModal.importError', { error })} type="error" />
          )}

          {importedId && (
            <Flexbox gap={8}>
              <Alert title={t('publishing.imported', { ns: 'discover' })} type="success" />
              <Button onClick={() => setSubmitOpen(true)}>
                {t('publishing.submit', { ns: 'discover' })}
              </Button>
              <Button onClick={handleClose}>{t('common:close')}</Button>
            </Flexbox>
          )}
          {!importedId && (
            <Upload.Dragger
              accept=".zip,.skill"
              disabled={loading || !canCreate}
              showUploadList={false}
              beforeUpload={(file) => {
                if (!canCreate) return false;
                handleUploadFile(file);
                return false;
              }}
            >
              <Flexbox align="center" gap={8} padding={24}>
                {loading ? (
                  <>
                    <Spin indicator={<LoadingOutlined spin />} />
                    <Typography.Text type="secondary">
                      {t('agentSkillModal.upload.uploading')}
                    </Typography.Text>
                  </>
                ) : (
                  <>
                    <Icon
                      icon={InboxIcon}
                      size={48}
                      style={{ color: 'var(--ant-color-text-quaternary)' }}
                    />
                    <Typography.Text type="secondary">
                      {t('agentSkillModal.upload.dragText')}
                    </Typography.Text>
                  </>
                )}
              </Flexbox>
            </Upload.Dragger>
          )}

          <Flexbox gap={8}>
            <Typography.Text strong>{t('agentSkillModal.upload.requirements')}</Typography.Text>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>
                <Typography.Text type="secondary">
                  {t('agentSkillModal.upload.requirementZip')}
                </Typography.Text>
              </li>
              <li>
                <Typography.Text type="secondary">
                  {t('agentSkillModal.upload.requirementSkillMd')}
                </Typography.Text>
              </li>
            </ul>
          </Flexbox>
        </Flexbox>
      </Modal>
      {importedId && (
        <SubmitSkillModal
          key={importedId}
          open={submitOpen}
          skillId={importedId}
          onClose={() => setSubmitOpen(false)}
          onSuccess={handleClose}
        />
      )}
    </>
  );
});

UploadSkillModal.displayName = 'UploadSkillModal';

export default UploadSkillModal;
