'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Modal, Select } from '@lobehub/ui/base-ui';
import { App, Form, Input, Tabs, Upload } from 'antd';
import { sha256 } from 'js-sha256';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

const GITHUB_URL_REGEX =
  /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/(?:tree|blob)\/[^?#]+)?\/?$/;

export const SubmitRepoModal = memo<SubmitRepoModalProps>(
  ({ open, onClose, onSuccess, beforeSubmit, skillId }) => {
    const { t } = useTranslation('discover');
    const { message } = App.useApp();
    const [form] = Form.useForm();

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [mode, setMode] = useState<'github' | 'zip' | 'personal'>(skillId ? 'personal' : 'zip');
    const uploadGeneration = useRef(0);
    const [zipFileId, setZipFileId] = useState<string>();
    const skills = useToolStore((s) => s.agentSkills);
    const fetchSkills = useToolStore((s) => s.useFetchAgentSkills);
    const refreshSkills = useToolStore((s) => s.refreshAgentSkills);
    fetchSkills(open);
    const [selectedSkill, setSelectedSkill] = useState(skillId);
    const [zipName, setZipName] = useState<string>();

    const handleSubmit = useCallback(async () => {
      try {
        setIsSubmitting(true);
        const submitContext = await beforeSubmit?.();
        let workflowState: string | undefined;
        if (mode === 'personal') {
          if (!selectedSkill) throw new Error(t('publishing.chooseSkill'));
          const result = await lambdaClient.market.socialProfile.submitPersonalSkill.mutate({
            skillId: selectedSkill,
          });
          workflowState = result.status;
          await refreshSkills().catch((error) => {
            console.error('[SubmitRepoModal] Failed to refresh skills:', error);
          });
        } else if (mode === 'github') {
          const values = await form.validateFields();
          const gitUrl = values.gitUrl?.trim();
          if (!gitUrl) return;
          await lambdaClient.market.socialProfile.submitRepo.mutate({
            actAs: submitContext?.actAs,
            gitUrl,
            type: 'skill',
          });
        } else {
          if (!zipFileId) throw new Error(t('user.zipRequired'));
          const result = await lambdaClient.market.socialProfile.submitZip.mutate({
            actAs: submitContext?.actAs,
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
        message.success(
          workflowState === 'published'
            ? t('publishing.alreadyPublished')
            : t('publishing.submitted'),
        );
        onSuccess?.();
        onClose();
        form.resetFields();
        setZipFileId(undefined);
        setZipName(undefined);
      } catch (error) {
        console.error('[SubmitRepoModal] Failed to submit:', error);
        const detail = error instanceof Error ? error.message : '';
        message.error(
          detail.startsWith('Invalid skill manifest:')
            ? t('publishing.invalidManifest')
            : detail || t('user.submitRepoError'),
        );
      } finally {
        setIsSubmitting(false);
      }
    }, [
      beforeSubmit,
      form,
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
        setZipFileId(undefined);
        setZipName(undefined);
        if (file.size > 16 * 1024 * 1024) {
          message.error(t('user.zipTooLarge'));
          return;
        }
        setIsSubmitting(true);
        try {
          const { data: metadata } = await uploadService.uploadFileToS3(file, {
            directory: 'market-submissions',
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
          message.error(error instanceof Error ? error.message : t('user.submitRepoError'));
        } finally {
          setIsSubmitting(false);
        }
      },
      [message, t],
    );

    const handleCancel = useCallback(() => {
      ++uploadGeneration.current;
      form.resetFields();
      setZipFileId(undefined);
      setZipName(undefined);
      onClose();
    }, [form, onClose]);

    return (
      <Modal
        centered
        cancelButtonProps={{ disabled: isSubmitting }}
        cancelText={t('user.cancel')}
        closable={!isSubmitting}
        confirmLoading={isSubmitting}
        maskClosable={!isSubmitting}
        okText={t('user.submit')}
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
        onOk={handleSubmit}
      >
        <Text strong fontSize={20} style={{ display: 'block', marginBottom: 8, marginTop: 16 }}>
          {t('user.submitRepoTitle')}
        </Text>
        <Text style={{ display: 'block', marginBottom: 16 }} type="secondary">
          {t('user.submitRepoDescription')}
        </Text>

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
                <Form form={form} layout="vertical">
                  <Form.Item
                    label={t('user.githubUrl')}
                    name="gitUrl"
                    rules={[
                      { required: true, message: t('user.githubUrlRequired') },
                      { pattern: GITHUB_URL_REGEX, message: t('user.githubUrlInvalid') },
                    ]}
                  >
                    <Input placeholder="https://github.com/username/repo" />
                  </Form.Item>
                </Form>
              ),
              key: 'github',
              label: 'GitHub',
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
          onChange={(key) => setMode(key as 'github' | 'zip' | 'personal')}
        />

        <Flexbox style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('user.submitRepoHint')}
          </Text>
        </Flexbox>
      </Modal>
    );
  },
);

SubmitRepoModal.displayName = 'SubmitRepoModal';

export default SubmitRepoModal;
