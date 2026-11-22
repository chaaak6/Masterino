import type { WorkspaceScanErrorCode } from '@lobechat/device-control/workspaceError';
import { Alert, Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { electronSystemService } from '@/services/electron/system';
import { useElectronStore } from '@/store/electron';
import { isMacOS } from '@/utils/platform';

const filesAndFoldersSettings =
  'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_FilesAndFolders';

const WorkspaceScanRecovery = memo<{
  code: WorkspaceScanErrorCode;
  localMacDeviceId?: string;
  onRetry?: () => void;
}>(({ code, localMacDeviceId, onRetry }) => {
  const { t } = useTranslation('error');
  const deviceId = useElectronStore((state) => state.gatewayDeviceInfo?.deviceId);
  const canOpenSettings =
    code === 'WORKSPACE_MACOS_FOLDER_ACCESS_DENIED' &&
    isDesktop &&
    isMacOS() &&
    !!localMacDeviceId &&
    localMacDeviceId === deviceId;

  return (
    <Alert
      showIcon
      description={canOpenSettings ? t('workspaceScan.macOSSettingsDescription') : undefined}
      title={t(`workspaceScan.${code}`)}
      type="secondary"
      action={
        <Flexbox horizontal gap={8}>
          {canOpenSettings && (
            <Button
              size="small"
              onClick={() => void electronSystemService.openExternalLink(filesAndFoldersSettings)}
            >
              {t('workspaceScan.openSettings')}
            </Button>
          )}
          {onRetry && (
            <Button size="small" onClick={onRetry}>
              {t('workspaceScan.retry')}
            </Button>
          )}
        </Flexbox>
      }
    />
  );
});

export default WorkspaceScanRecovery;
