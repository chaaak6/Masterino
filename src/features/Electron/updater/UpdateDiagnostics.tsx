import type {
  UpdaterDiagnostic,
  UpdaterDiagnosticStepName,
  UpdaterState,
} from '@lobechat/electron-client-ipc';
import { Button, copyToClipboard, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { autoUpdateService } from '@/services/electron/autoUpdate';
import { electronSystemService } from '@/services/electron/system';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  details: css`
    padding: 10px 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};

    summary {
      cursor: pointer;
      font-weight: 600;
    }
  `,
  error: css`
    padding: 10px 12px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorErrorText};
    overflow-wrap: anywhere;
    background: ${cssVar.colorErrorBg};
  `,
  grid: css`
    display: grid;
    grid-template-columns: minmax(120px, auto) minmax(0, 1fr);
    gap: 6px 16px;

    font-size: 13px;
  `,
  label: css`
    color: ${cssVar.colorTextSecondary};
  `,
  steps: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    margin-block-start: 12px;
    padding: 0;

    list-style: none;
  `,
  stepTime: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
  `,
}));

const STEP_KEYS = {
  'artifact-selected': 'updater.diagnostic.step.artifactSelected',
  'artifact-verified': 'updater.diagnostic.step.artifactVerified',
  'check-completed': 'updater.diagnostic.step.checkCompleted',
  'check-started': 'updater.diagnostic.step.checkStarted',
  'download-completed': 'updater.diagnostic.step.downloadCompleted',
  'download-started': 'updater.diagnostic.step.downloadStarted',
  'failed': 'updater.diagnostic.step.failed',
  'manifest-received': 'updater.diagnostic.step.manifestReceived',
  'manifest-requested': 'updater.diagnostic.step.manifestRequested',
  'manifest-verified': 'updater.diagnostic.step.manifestVerified',
  'update-opened': 'updater.diagnostic.step.updateOpened',
  'version-compared': 'updater.diagnostic.step.versionCompared',
} as const satisfies Record<UpdaterDiagnosticStepName, string>;

export const formatUpdaterDiagnostic = (diagnostic: UpdaterDiagnostic): string => {
  const lines = [
    'Masterino update diagnostics',
    `ID: ${diagnostic.id}`,
    `Started: ${diagnostic.startedAt}`,
    `Finished: ${diagnostic.finishedAt ?? '-'}`,
    `Trigger: ${diagnostic.trigger}`,
    `Installed: ${diagnostic.currentVersion}`,
    `Target: ${diagnostic.targetVersion ?? '-'}`,
    `Channel: ${diagnostic.channel}`,
    `Platform: ${diagnostic.platform}/${diagnostic.arch}`,
    `Stage: ${diagnostic.stage}`,
    `Failure stage: ${diagnostic.failedStep ?? '-'}`,
    `Manifest: ${diagnostic.manifestUrl}`,
    `Manifest HTTP: ${diagnostic.manifestHttpStatus ?? '-'}`,
    `Artifact: ${diagnostic.artifact?.path ?? '-'}`,
    `Error: ${diagnostic.errorCode ? `${diagnostic.errorCode}: ${diagnostic.errorMessage ?? '-'}` : '-'}`,
    'Steps:',
    ...diagnostic.steps.map(
      (step) =>
        `- ${step.at} [${step.status}] ${step.name}${step.detail ? `: ${step.detail}` : ''}`,
    ),
  ];
  return lines.join('\n');
};

interface UpdateDiagnosticsProps {
  onCheck?: () => Promise<void> | void;
  showCheckAction?: boolean;
  state: UpdaterState;
}

export const UpdateDiagnostics = ({
  onCheck,
  showCheckAction = false,
  state,
}: UpdateDiagnosticsProps) => {
  const { t, i18n } = useTranslation('electron');
  const diagnostic = state.diagnostic;
  const runtime = state.runtime;
  const busy = state.stage === 'checking' || state.stage === 'downloading';

  const copyDiagnostic = async () => {
    if (diagnostic) await copyToClipboard(formatUpdaterDiagnostic(diagnostic));
  };

  const checkNow = async () => {
    if (onCheck) await onCheck();
    else await autoUpdateService.checkUpdate();
  };

  return (
    <Flexbox gap={12}>
      <div className={styles.grid}>
        <span className={styles.label}>{t('updater.diagnostic.currentVersion')}</span>
        <span>{runtime?.currentVersion ?? diagnostic?.currentVersion ?? '-'}</span>
        <span className={styles.label}>{t('updater.diagnostic.buildChannel')}</span>
        <span>{runtime?.buildChannel ?? '-'}</span>
        <span className={styles.label}>{t('updater.diagnostic.updateChannel')}</span>
        <span>{runtime?.updateChannel ?? diagnostic?.channel ?? '-'}</span>
        <span className={styles.label}>{t('updater.diagnostic.platform')}</span>
        <span>
          {runtime
            ? `${runtime.platform}/${runtime.arch}`
            : diagnostic
              ? `${diagnostic.platform}/${diagnostic.arch}`
              : '-'}
        </span>
        <span className={styles.label}>{t('updater.diagnostic.lastChecked')}</span>
        <span>
          {diagnostic ? new Date(diagnostic.startedAt).toLocaleString(i18n.language) : '-'}
        </span>
        <span className={styles.label}>{t('updater.diagnostic.targetVersion')}</span>
        <span>{diagnostic?.targetVersion ?? '-'}</span>
        <span className={styles.label}>{t('updater.diagnostic.stage')}</span>
        <span>{diagnostic ? t(`updater.diagnostic.stageValue.${diagnostic.stage}`) : '-'}</span>
        {diagnostic?.errorCode && (
          <>
            <span className={styles.label}>{t('updater.diagnostic.failureStage')}</span>
            <span>{diagnostic.failedStep ? t(STEP_KEYS[diagnostic.failedStep]) : '-'}</span>
          </>
        )}
      </div>

      {diagnostic?.errorMessage && (
        <div className={styles.error} role="alert">
          <strong>{diagnostic.errorCode ?? 'unknown'}</strong>: {diagnostic.errorMessage}
        </div>
      )}

      {diagnostic && (
        <details className={styles.details} open={state.stage === 'error'}>
          <summary>{t('updater.diagnostic.details')}</summary>
          <ol className={styles.steps}>
            {diagnostic.steps.map((step, index) => (
              <li key={`${step.at}-${step.name}-${index}`}>
                <Flexbox horizontal align="flex-start" gap={8}>
                  <span className={styles.stepTime}>{new Date(step.at).toLocaleTimeString()}</span>
                  <span>
                    <strong>{t(STEP_KEYS[step.name])}</strong>
                    {step.detail ? ` — ${step.detail}` : ''}
                  </span>
                </Flexbox>
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className={styles.actions}>
        {showCheckAction && (
          <Button
            disabled={busy}
            loading={state.stage === 'checking'}
            onClick={() => void checkNow()}
          >
            {t('updater.diagnostic.checkNow')}
          </Button>
        )}
        <Button disabled={!diagnostic} onClick={() => void copyDiagnostic()}>
          {t('updater.diagnostic.copy')}
        </Button>
        <Button onClick={() => void electronSystemService.openLogsDirectory()}>
          {t('updater.diagnostic.openLogs')}
        </Button>
        {state.manualDownloadAvailable && (
          <Button onClick={() => void autoUpdateService.openManualDownload()}>
            {t('updater.diagnostic.manualDownload')}
          </Button>
        )}
      </div>
    </Flexbox>
  );
};
