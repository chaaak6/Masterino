import { Center, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { localFileService } from '@/services/electron/localFileService';

interface WorkspaceVideoProps {
  filePath: string;
  filename: string;
  playable: boolean;
  workingDirectory: string;
}

const WorkspaceVideo = memo<WorkspaceVideoProps>(
  ({ filePath, filename, playable, workingDirectory }) => {
    const { t } = useTranslation('chat');
    const [opening, setOpening] = useState(false);
    const [failed, setFailed] = useState(false);

    const openVideo = async () => {
      setFailed(false);
      setOpening(true);
      try {
        const result = await localFileService.openWorkspaceMp4({
          path: filePath,
          workingDirectory,
        });
        setFailed(!result.success);
      } catch {
        setFailed(true);
      } finally {
        setOpening(false);
      }
    };

    return (
      <Center height="100%" width="100%">
        <Flexbox align="center" gap={12} padding={16}>
          <Text>{filename}</Text>
          {playable ? (
            <Button loading={opening} onClick={openVideo}>
              {t('workingPanel.localFile.preview.openVideo')}
            </Button>
          ) : (
            <Text type="secondary">
              {t('workingPanel.localFile.preview.remoteVideoUnavailable')}
            </Text>
          )}
          {failed && (
            <span role="status">{t('workingPanel.localFile.preview.openVideoError')}</span>
          )}
        </Flexbox>
      </Center>
    );
  },
);

WorkspaceVideo.displayName = 'WorkspaceVideo';

export default WorkspaceVideo;
