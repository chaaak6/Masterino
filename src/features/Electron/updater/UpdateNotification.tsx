import { type UpdaterState, useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Button, Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Modal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleFadingArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { autoUpdateService } from '@/services/electron/autoUpdate';

import { UpdateDiagnostics } from './UpdateDiagnostics';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    position: fixed;
    z-index: 1000;
    inset-block-end: 16px;
    inset-inline-start: 16px;
    width: min(420px, calc(100vw - 32px));
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadow};
  `,
  actions: css`
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-block-start: 12px;
  `,
  progress: css`
    width: 100%;
    height: 8px;
    margin-block: 10px 4px;
    accent-color: ${cssVar.colorPrimary};
  `,
  releaseNote: css`
    overflow-y: auto;
    max-height: 300px;
    padding: 8px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export const UpdateNotification = () => {
  const { t } = useTranslation('electron');
  const [state, setState] = useState<UpdaterState>({ autoDownloadEnabled: false, stage: 'idle' });
  const [details, setDetails] = useState(false);
  const [acting, setActing] = useState(false);
  useEffect(() => {
    void autoUpdateService
      .getUpdaterState()
      .then(setState)
      .catch(() => undefined);
  }, []);
  useWatchBroadcast('updaterStateChanged', setState);
  useWatchBroadcast('updateWillInstallLater', () => {
    setState((s) => ({ ...s, stage: 'idle' }));
    setDetails(false);
  });

  const downloading = state.stage === 'downloading';
  const verifying = state.stage === 'verifying';
  const preparing = state.stage === 'preparing-install';
  const failed = state.stage === 'error';
  const downloaded = state.stage === 'downloaded';
  const busy = downloading || verifying || preparing;
  if (
    !['available', 'downloading', 'verifying', 'preparing-install', 'downloaded', 'error'].includes(
      state.stage,
    )
  )
    return null;
  const title = failed
    ? t(`updater.error.${state.errorCode ?? 'unknown'}`)
    : t(
        preparing
          ? 'updater.preparingInstall'
          : verifying
            ? 'updater.verifying'
            : downloading
              ? 'updater.downloadingUpdate'
              : downloaded
                ? 'updater.updateReady'
                : 'updater.newVersionAvailable',
      );
  const progress = state.progress;
  const primary = async () => {
    setActing(true);
    try {
      if (downloaded || (failed && state.errorCode === 'install'))
        await autoUpdateService.applyDownloadedUpdate();
      else if (state.updateInfo) await autoUpdateService.downloadUpdate();
      else await autoUpdateService.checkUpdate();
    } finally {
      setActing(false);
    }
  };
  const dismiss = () => {
    setState((s) => ({ ...s, stage: 'idle' }));
    setDetails(false);
  };
  const status = (
    <>
      {busy && (
        <progress
          aria-label={title}
          className={styles.progress}
          max={100}
          value={downloading ? (progress?.percent ?? 0) : undefined}
        />
      )}
      {downloading && progress && (
        <div style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
          {t('updater.transferDetails', {
            downloaded: megabytes(progress.transferred),
            total: megabytes(progress.total),
            speed: megabytes(progress.bytesPerSecond),
            percent: Math.floor(progress.percent),
          })}
        </div>
      )}
      {preparing && (
        <div style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
          {t('updater.preparingInstallDesc')}
        </div>
      )}
    </>
  );
  const actions = (
    <div className={styles.actions}>
      {!busy && (
        <Button size="small" onClick={dismiss}>
          {t('updater.later')}
        </Button>
      )}
      {downloading && (
        <Button size="small" onClick={() => void autoUpdateService.cancelDownload()}>
          {t('updater.cancelDownload')}
        </Button>
      )}
      {!busy && (
        <Button loading={acting} size="small" type="primary" onClick={() => void primary()}>
          {t(
            downloaded
              ? 'updater.restartAndInstall'
              : failed
                ? 'updater.retry'
                : 'updater.downloadNewVersion',
          )}
        </Button>
      )}
    </div>
  );
  return (
    <>
      <div className={styles.container} role="status">
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={CircleFadingArrowUp} size={18} />
          <Button
            size="small"
            type="text"
            style={{ minWidth: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'start' }}
            onClick={() => setDetails(true)}
          >
            {title}
            {state.updateInfo?.version ? ` · ${state.updateInfo.version}` : ''}
            {state.diagnostic?.artifact?.size
              ? ` · ${megabytes(state.diagnostic.artifact.size)} MB`
              : ''}
          </Button>
        </Flexbox>
        {status}
        {actions}
      </div>
      <Modal
        footer={null}
        open={details}
        title={title}
        width={520}
        onCancel={() => setDetails(false)}
      >
        <Flexbox gap={12}>
          {failed && <UpdateDiagnostics state={state} />}
          <div style={{ color: cssVar.colorTextSecondary }}>{state.updateInfo?.version}</div>
          {status}
          {state.updateInfo?.releaseNotes && (
            <div className={styles.releaseNote}>
              {typeof state.updateInfo.releaseNotes === 'string' ? (
                <Markdown>{state.updateInfo.releaseNotes}</Markdown>
              ) : (
                state.updateInfo.releaseNotes.map((note) => (
                  <Markdown key={note.version}>{note.note ?? ''}</Markdown>
                ))
              )}
            </div>
          )}
          {actions}
        </Flexbox>
      </Modal>
    </>
  );
};
