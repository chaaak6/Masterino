'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { Modal, Select } from '@lobehub/ui/base-ui';
import { App, Tabs, Upload } from 'antd';
import { sha256 } from 'js-sha256';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSkillCategorySummary } from '@/hooks/useSkillCategory';
import { mutate } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { uploadService } from '@/services/upload';
import { useToolStore } from '@/store/tool';

interface SubmitRepoModalProps {
  beforeSubmit?: () => Promise<{ actAs?: number } | void>;
  onClose: () => void;
  onSuccess?: () => void;
  open: boolean;
  skillId?: string;
}

export const SubmitRepoModal = memo<SubmitRepoModalProps>(
  ({ open, onClose, onSuccess, beforeSubmit, skillId }) => {
    const { t } = useTranslation('discover');
    const { message } = App.useApp();

    const [category, setCategory] = useState<string>();
    const categorySummary = useSkillCategorySummary({}, open);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [zipSubmission, setZipSubmission] = useState<'submitted' | 'alreadyPublished'>();
    const [submissionError, setSubmissionError] = useState<string>();
    const [mode, setMode] = useState<'zip' | 'personal'>(skillId ? 'personal' : 'zip');
    const uploadGeneration = useRef(0);
    const [zipFileId, setZipFileId] = useState<string>();
    const skills = useToolStore((s) => s.agentSkills);
    const fetchSkills = useToolStore((s) => s.useFetchAgentSkills);
    const refreshSkills = useToolStore((s) => s.refreshAgentSkills);
    const importZip = useToolStore((s) => s.importAgentSkillFromZip);
    fetchSkills(open);
    const [selectedSkill, setSelectedSkill] = useState(skillId);
    const [zipName, setZipName] = useState<string>();

    useEffect(() => {
      if (open && skillId) {
        setMode('personal');
        setSelectedSkill(skillId);
      }
    }, [open, skillId]);

    const handleSubmit = useCallback(async () => {
      try {
        setIsSubmitting(true);
        setSubmissionError(undefined);
        const submitContext = await beforeSubmit?.();
        let workflowState: string | undefined;
        if (mode === 'personal') {
          if (!selectedSkill) throw new Error(t('publishing.chooseSkill'));
          const result = await lambdaClient.market.socialProfile.submitPersonalSkill.mutate({
            skillId: selectedSkill,
            category,
          });
          workflowState = result.status;
          await refreshSkills().catch((error) => {
            console.error('[SubmitRepoModal] Failed to refresh skills:', error);
          });
        } else {
          if (!zipFileId) throw new Error(t('user.zipRequired'));
          const result = await lambdaClient.market.socialProfile.submitZip.mutate({
            actAs: submitContext?.actAs,
            category,
            zipFileId,
          });
          workflowState = result.status;
        }

        if (workflowState === 'rejected') {
          message.warning(t('publishing.rejected'));
          return;
        }
        if (workflowState === 'deprecated') {
          message.warning(t('publishing.deprecated'));
          return;
        }
        const successKey = workflowState === 'published' ? 'alreadyPublished' : 'submitted';
        message.success(t(`publishing.${successKey}`));
        void mutate(
          (key) =>
            Array.isArray(key) &&
            ['discover:skillList', 'discover:skillCategorySummary'].includes(key[0]),
        );
        onSuccess?.();
        if (mode === 'zip' && submitContext?.actAs === undefined) {
          setZipSubmission(successKey);
          return;
        }
        onClose();
        setZipFileId(undefined);
        setZipName(undefined);
      } catch (error) {
        console.error('[SubmitRepoModal] Failed to submit:', error);
        const detail = error instanceof Error ? error.message : '';
        const errorMessage =
          detail === 'version_rejected'
            ? t('publishing.rejected')
            : detail.startsWith('Invalid skill manifest:')
              ? t('publishing.invalidManifest')
              : detail || t('user.submitRepoError');
        setSubmissionError(errorMessage);
        message.error(errorMessage);
      } finally {
        setIsSubmitting(false);
      }
    }, [
      beforeSubmit,
      category,
      message,
      mode,
      onSuccess,
      onClose,
      refreshSkills,
      t,
      zipFileId,
      selectedSkill,
    ]);

    const handleZipUpload = useCallback(
      async (file: File) => {
        const generation = ++uploadGeneration.current;
        setSubmissionError(undefined);
        setZipFileId(undefined);
        setZipName(undefined);
        if (file.size > 16 * 1024 * 1024) {
          message.error(t('user.zipTooLarge'));
          return;
        }
        setIsSubmitting(true);
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
          if (generation !== uploadGeneration.current) return;
          setZipFileId(result.id);
          setZipName(file.name);
        } catch (error) {
          if (generation === uploadGeneration.current)
            message.error(error instanceof Error ? error.message : t('user.submitRepoError'));
        } finally {
          if (generation === uploadGeneration.current) setIsSubmitting(false);
        }
      },
      [message, t],
    );

    const handleCancel = useCallback(() => {
      ++uploadGeneration.current;
      setZipFileId(undefined);
      setZipName(undefined);
      setCategory(undefined);
      setSubmissionError(undefined);
      setZipSubmission(undefined);
      onClose();
    }, [onClose]);

    const handleInstall = async () => {
      if (!zipFileId) return;
      setIsSubmitting(true);
      setSubmissionError(undefined);
      try {
        const result = await importZip({ zipFileId });
        if (!result) throw new Error(t('publishing.installFailed'));
        message.success(t('publishing.installSucceeded'));
        handleCancel();
      } catch (error) {
        setSubmissionError(error instanceof Error ? error.message : t('publishing.installFailed'));
      } finally {
        setIsSubmitting(false);
      }
    };

    return (
      <Modal
        centered
        cancelButtonProps={{ disabled: isSubmitting }}
        cancelText={zipSubmission ? t('close', { ns: 'common' }) : t('user.cancel')}
        closable={!isSubmitting}
        confirmLoading={isSubmitting}
        maskClosable={!isSubmitting}
        okText={t(zipSubmission ? 'publishing.installToLibrary' : 'user.submit')}
        open={open}
        title={false}
        width={480}
        okButtonProps={{
          disabled:
            isSubmitting ||
            (mode === 'zip' && !zipFileId) ||
            (mode === 'personal' && !selectedSkill),
        }}
        onCancel={handleCancel}
        onOk={zipSubmission ? handleInstall : handleSubmit}
      >
        {zipSubmission ? (
          <Flexbox gap={12} style={{ marginTop: 16 }}>
            <Text strong fontSize={20}>
              {t(`publishing.${zipSubmission}`)}
            </Text>
            <Text type="secondary">{t('publishing.installSubmittedZipHint')}</Text>
            {submissionError && <Text type="danger">{submissionError}</Text>}
          </Flexbox>
        ) : (
          <>
            <Text strong fontSize={20} style={{ display: 'block', marginBottom: 8, marginTop: 16 }}>
              {t('user.submitRepoTitle')}
            </Text>
            <Text style={{ display: 'block', marginBottom: 16 }} type="secondary">
              {t('user.submitRepoDescription')}
            </Text>

            {submissionError && <Text type="danger">{submissionError}</Text>}
            <Select
              allowClear
              placeholder={t('publishing.categoryPlaceholder')}
              value={category}
              options={(categorySummary.data?.categories ?? [])
                .filter((item) => item.registered)
                .map((item) => ({ label: item.name, value: item.category }))}
              onChange={(value) => setCategory(value as string | undefined)}
            />
            {categorySummary.error && (
              <Text type="danger">
                {t('skills.categories.loadError')}
                <Button size="small" onClick={() => void categorySummary.mutate()}>
                  {t('retry', { ns: 'common' })}
                </Button>
              </Text>
            )}
            <Text type="secondary">{t('publishing.categoryHint')}</Text>
            <Tabs
              activeKey={mode}
              items={[
                {
                  key: 'personal',
                  label: t('publishing.mySkills'),
                  children: (
                    <Select
                      placeholder={t('publishing.chooseSkill')}
                      value={selectedSkill}
                      options={skills
                        .filter((s) => s.source === 'user')
                        .map((s) => ({ label: s.name, value: s.id }))}
                      onChange={(value) => setSelectedSkill(value as string)}
                    />
                  ),
                },
                {
                  children: (
                    <Upload.Dragger
                      accept=".zip,.skill"
                      disabled={isSubmitting}
                      maxCount={1}
                      showUploadList={false}
                      beforeUpload={(file) => {
                        void handleZipUpload(file);
                        return false;
                      }}
                    >
                      <Text>{zipName || t('user.zipUploadHint')}</Text>
                    </Upload.Dragger>
                  ),
                  key: 'zip',
                  label: t('user.submitZip'),
                },
              ]}
              onChange={(key) => setMode(key as 'zip' | 'personal')}
            />

            <Flexbox style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 12 }} type="secondary">
                {t('user.submitRepoHint')}
              </Text>
            </Flexbox>
          </>
        )}
      </Modal>
    );
  },
);

SubmitRepoModal.displayName = 'SubmitRepoModal';

export default SubmitRepoModal;
