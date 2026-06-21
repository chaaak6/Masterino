import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type FileUploadProcessStage,
  type FileUploadState,
  type FileUploadStatus,
} from '@/types/files/upload';
import { formatSize } from '@/utils/format';

interface UploadStateProps {
  errorReason?: string;
  processStage?: FileUploadProcessStage;
  size: number;
  status: FileUploadStatus;
  uploadState?: FileUploadState;
}

const getProcessingStatusKey = (processStage?: FileUploadProcessStage) => {
  switch (processStage) {
    case 'content_parsing': {
      return 'upload.preview.status.contentParsing';
    }
    case 'chunking': {
      return 'upload.preview.status.chunking';
    }
    case 'embedding': {
      return 'upload.preview.status.embedding';
    }
    case 'file_record_creating': {
      return 'upload.preview.status.saving';
    }
    default: {
      return 'upload.preview.status.processing';
    }
  }
};

const getErrorStatusKey = (processStage?: FileUploadProcessStage) => {
  switch (processStage) {
    case 'storage_upload_failed': {
      return 'upload.preview.status.uploadFailed';
    }
    case 'file_record_failed': {
      return 'upload.preview.status.recordFailed';
    }
    case 'chunk_failed': {
      return 'upload.preview.status.chunkFailed';
    }
    case 'embedding_failed': {
      return 'upload.preview.status.embeddingFailed';
    }
    case 'content_parse_failed': {
      return 'upload.preview.status.error';
    }
    default: {
      return 'upload.preview.status.failed';
    }
  }
};

const UploadStatus = memo<UploadStateProps>(
  ({ status, size, uploadState, processStage, errorReason }) => {
    const { t } = useTranslation('chat');

    switch (status) {
      default:
      case 'pending': {
        return (
          <Flexbox horizontal align={'center'} gap={4}>
            <Icon spin icon={Loader2Icon} size={12} />
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('upload.preview.status.pending')}
            </Text>
          </Flexbox>
        );
      }

      case 'uploading': {
        return (
          <Flexbox horizontal align={'center'} gap={4}>
            <Progress percent={uploadState?.progress} size={14} type="circle" />
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {formatSize(size * ((uploadState?.progress || 0) / 100), 0)}
            </Text>
          </Flexbox>
        );
      }

      case 'processing': {
        return (
          <Flexbox horizontal align={'center'} gap={4}>
            <Progress percent={uploadState?.progress} size={14} type="circle" />
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t(getProcessingStatusKey(processStage))}
            </Text>
          </Flexbox>
        );
      }

      case 'success': {
        return (
          <Flexbox horizontal align={'center'} gap={4}>
            <CheckCircleFilled style={{ color: cssVar.colorSuccess, fontSize: 12 }} />
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {formatSize(size)}
            </Text>
          </Flexbox>
        );
      }

      case 'error': {
        return (
          <Flexbox horizontal align={'center'} gap={4}>
            <CloseCircleFilled style={{ color: cssVar.colorError, fontSize: 12 }} />
            <Text style={{ fontSize: 12 }} title={errorReason} type={'danger'}>
              {t(getErrorStatusKey(processStage))}
            </Text>
          </Flexbox>
        );
      }
    }
  },
);

export default UploadStatus;
