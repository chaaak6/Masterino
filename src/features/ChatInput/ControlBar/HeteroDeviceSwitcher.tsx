'use client';

import { SiApple, SiLinux } from '@icons-pack/react-simple-icons';
import { isDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { Microsoft } from '@lobehub/icons';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import {
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverRoot,
  PopoverTriggerElement,
  PopoverViewport,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  BoxIcon,
  CheckIcon,
  ChevronDownIcon,
  InfoIcon,
  LaptopIcon,
  LockIcon,
  MonitorDownIcon,
  MonitorIcon,
  MonitorOffIcon,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDesktopDownload } from '@/features/DesktopDownload';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { lambdaQuery } from '@/libs/trpc/client';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border: none;
    border-radius: 6px;

    font: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  buttonLabel: css`
    overflow: hidden;
    max-width: 120px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  readOnly: css`
    cursor: default;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: transparent;
    }
  `,
  readOnlyLock: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  check: css`
    flex: none;
    margin-inline-start: auto;
    color: ${cssVar.colorPrimary};
  `,
  desc: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
  `,
  dotOffline: css`
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorTextQuaternary};
  `,
  dotOnline: css`
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
    box-shadow: 0 0 0 2px ${cssVar.colorSuccessBg};
  `,
  empty: css`
    padding-block: 8px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  downloadCard: css`
    width: 100%;
    font: inherit;
    text-align: start;
    cursor: pointer;
    border: none;
    color: inherit;
    background: transparent;

    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    text-decoration: none;

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  downloadCardArrow: css`
    flex: none;
    margin-inline-start: auto;
    color: ${cssVar.colorTextQuaternary};
  `,
  option: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 8px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    width: 100%;
    font: inherit;
    text-align: start;
    background: transparent;

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      background: ${cssVar.colorFillTertiary};
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: -2px;
    }
  `,
  optionActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  optionDisabled: css`
    cursor: not-allowed;
    opacity: 0.55;

    &:hover {
      background: transparent;
    }
  `,
  optionIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};
  `,
  optionMeta: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;

    min-width: 0;
  `,
  optionTitle: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tag: css`
    flex: none;

    padding-block: 0;
    padding-inline: 5px;
    border-radius: 4px;

    font-size: 10px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  localDeviceName: css`
    overflow: hidden;
    display: block;
    max-width: 140px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  header: css`
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: space-between;

    padding-block: 6px 4px;
    padding-inline: 8px;
  `,
  headerInfo: css`
    cursor: help;
    color: ${cssVar.colorTextQuaternary};
    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  headerLink: css`
    border: none;
    padding: 0;
    font: inherit;
    background: transparent;
    display: flex;
    gap: 3px;
    align-items: center;

    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
    text-decoration: none;

    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  headerTitle: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface OptionRowProps {
  active: boolean;
  desc?: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tag?: ReactNode;
}

const OptionRow = memo<OptionRowProps>(({ active, desc, disabled, icon, label, onClick, tag }) => {
  return (
    <button
      aria-pressed={active}
      disabled={disabled}
      type="button"
      className={cx(
        styles.option,
        active && styles.optionActive,
        disabled && styles.optionDisabled,
      )}
      onClick={onClick}
    >
      <div className={styles.optionIcon}>{icon}</div>
      <div className={styles.optionMeta}>
        <Flexbox horizontal align={'center'} gap={6}>
          <span className={styles.optionTitle}>{label}</span>
          {tag ? <span className={styles.tag}>{tag}</span> : null}
        </Flexbox>
        {desc ? <div className={styles.desc}>{desc}</div> : null}
      </div>
      {active ? <Icon className={styles.check} icon={CheckIcon} size={14} /> : null}
    </button>
  );
});

OptionRow.displayName = 'HeteroDeviceSwitcher.OptionRow';

const getDeviceIcon = (platform: string | null | undefined, size = 14): ReactNode => {
  switch (platform) {
    case 'darwin': {
      return <SiApple color="currentColor" size={size} />;
    }
    case 'linux': {
      return <SiLinux color="currentColor" size={size} />;
    }
    case 'win32': {
      return <Microsoft color="currentColor" size={size} />;
    }
    default: {
      return <Icon icon={MonitorIcon} size={size} />;
    }
  }
};

interface HeteroDeviceSwitcherProps {
  agentId: string;
  /**
   * Conversation-scoped device to display instead of the agent's stored
   * `boundDeviceId`. Used together with `executionTarget` / `onSelectTarget`.
   */
  boundDeviceId?: string;
  /**
   * Conversation-scoped target to display (draft intent or topic snapshot).
   * When omitted the agent's stored default is resolved.
   */
  executionTarget?: DeviceExecutionTarget;
  /**
   * Conversation-scoped write path. When provided, a selection is handed to
   * this callback (draft intent / topic snapshot capture) and the agent's
   * stored defaults are never written.
   */
  onSelectTarget?: (target: DeviceExecutionTarget, deviceId?: string) => Promise<void> | void;
  /** The topic has started, or a durable project has already been selected. */
  readOnly?: boolean;
}

const HeteroDeviceSwitcher = memo<HeteroDeviceSwitcherProps>(
  ({
    agentId,
    boundDeviceId: conversationDeviceId,
    executionTarget: conversationTarget,
    onSelectTarget,
    readOnly = false,
  }) => {
    const { t } = useTranslation(['chat', 'common']);
    const [open, setOpen] = useState(false);
    const { disabled: downloadDisabled, download, loading: downloading } = useDesktopDownload();

    const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
    const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

    const heteroType = agencyConfig?.heterogeneousProvider?.type;
    const boundDeviceId = onSelectTarget ? conversationDeviceId : agencyConfig?.boundDeviceId;

    // Heterogeneous agents (Claude Code / Codex — remote types already early-return
    // below) bring their own toolchain and must execute somewhere, so `'none'`
    // (plain chat, no execution environment) isn't a valid target for them: hide
    // the option and never fall back to / honour a stale stored `'none'`.
    const isHetero = !!heteroType;

    const { data: devices, isLoading } = lambdaQuery.device.listDevices.useQuery(undefined, {
      staleTime: 30_000,
    });

    // The current machine's gateway registration and the dedicated local option
    // describe the same execution target. Keep the id for dispatch, but present
    // this desktop only once in the picker.
    useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
    const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
    const gatewayState = useElectronStore((s) => s.gatewayConnectionState);
    const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

    // Effective target: shared with server dispatch. In particular, a hetero
    // desktop "local" selection that carries this desktop's boundDeviceId becomes
    // a device target when the same agent is opened from web.
    const resolvedExecutionTarget =
      conversationTarget ?? resolveExecutionTarget(agencyConfig, { isDesktop, isHetero });
    const executionTarget =
      isDesktop &&
      resolvedExecutionTarget === 'device' &&
      !!currentDeviceId &&
      boundDeviceId === currentDeviceId
        ? 'local'
        : resolvedExecutionTarget;
    const isCloudSandboxEnabled = useServerConfigStore(serverConfigSelectors.enableCloudSandbox);

    const handleSelect = useCallback(
      async (target: DeviceExecutionTarget, deviceId?: string) => {
        setOpen(false);

        // The current desktop may be persisted as a registered device target,
        // but the UI normalizes it to `local`. Re-selecting it is a no-op and
        // must not attempt to recapture an existing topic on an older server.
        if (target === executionTarget && (target !== 'device' || boundDeviceId === deviceId)) {
          return;
        }

        // `executionTarget` is the single source of truth — the server tool
        // gate + client `getRuntimeModeById` derive `runtimeMode` from it.
        let nextBoundDeviceId = target === 'device' ? deviceId : boundDeviceId;
        if (target === 'local') {
          nextBoundDeviceId = currentDeviceId;
          if (!nextBoundDeviceId) {
            try {
              nextBoundDeviceId = (await gatewayConnectionService.getDeviceInfo())?.deviceId;
            } catch {
              nextBoundDeviceId = undefined;
            }
          }
          if (isHetero && !nextBoundDeviceId) return;
        }

        // Conversation scope: the draft intent / topic snapshot owns the choice.
        if (onSelectTarget) {
          await onSelectTarget(target, nextBoundDeviceId);
          return;
        }

        await updateAgentConfigById(agentId, {
          agencyConfig: {
            ...agencyConfig,
            executionTarget: target,
            ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
          },
        });
      },
      [
        agentId,
        agencyConfig,
        boundDeviceId,
        currentDeviceId,
        executionTarget,
        isHetero,
        onSelectTarget,
        updateAgentConfigById,
      ],
    );

    // Don't render for remote hetero agents — they use RemoteAgentConfigCard in profile.
    if (heteroType && isRemoteHeterogeneousType(heteroType)) return null;

    const boundDevice =
      executionTarget === 'device' ? devices?.find((d) => d.deviceId === boundDeviceId) : undefined;
    const hasNoDevices = !devices || devices.length === 0;
    const selectableDevices = (devices ?? []).filter(
      (device) => !isDesktop || device.deviceId !== currentDeviceId,
    );
    const currentDevice = devices?.find((device) => device.deviceId === currentDeviceId);
    const localDeviceName =
      currentDevice?.friendlyName || currentDevice?.hostname || gatewayDeviceInfo?.name;
    // Gateway connectivity describes cross-device access, not whether this
    // desktop can run locally. Keep the local option selectable in every state.
    const localGatewayConnected = gatewayState.enabled && gatewayState.status === 'connected';
    const localGatewayConnecting =
      gatewayState.enabled &&
      ['connecting', 'authenticating', 'reconnecting'].includes(gatewayState.status);
    // On web with no device, the prominent download card below replaces the small
    // header link — avoid showing the same CTA twice.
    const showWebDownloadCard = !isDesktop && hasNoDevices && !isLoading;

    // Compute chip
    let chipIcon: ReactNode = <Icon icon={BoxIcon} size={14} />;
    let chipLabel = t('heteroAgent.executionTarget.sandbox');
    if (executionTarget === 'none') {
      chipIcon = <Icon icon={MonitorOffIcon} size={14} />;
      chipLabel = t('heteroAgent.executionTarget.none');
    } else if (executionTarget === 'local') {
      chipIcon = <Icon icon={LaptopIcon} size={14} />;
      chipLabel = t('heteroAgent.executionTarget.local');
    } else if (executionTarget === 'device') {
      chipIcon = getDeviceIcon(boundDevice?.platform);
      chipLabel =
        boundDevice?.friendlyName ??
        boundDevice?.hostname ??
        t('heteroAgent.executionTarget.unknownDevice');
    }

    const isActive = (target: DeviceExecutionTarget, deviceId?: string) => {
      if (target === 'device') return executionTarget === 'device' && boundDeviceId === deviceId;
      return executionTarget === target;
    };

    const renderDeviceRow = (d: NonNullable<typeof devices>[number]) => (
      <OptionRow
        active={isActive('device', d.deviceId)}
        disabled={!d.online}
        icon={getDeviceIcon(d.platform)}
        key={d.deviceId}
        label={d.friendlyName || d.hostname || d.deviceId}
        tag={d.deviceId === currentDeviceId ? t('heteroAgent.executionTarget.local') : undefined}
        desc={
          <>
            <span className={d.online ? styles.dotOnline : styles.dotOffline} />
            <span>
              {d.online
                ? t('heteroAgent.executionTarget.online')
                : t('heteroAgent.executionTarget.offline')}
            </span>
          </>
        }
        onClick={() => void handleSelect('device', d.deviceId)}
      />
    );

    const content = (
      <Flexbox gap={6} style={{ maxWidth: 320, minWidth: 280 }}>
        <div className={styles.header}>
          <Flexbox horizontal align={'center'} gap={4}>
            <span className={styles.headerTitle}>{t('heteroAgent.executionTarget.title')}</span>
            <Tooltip title={t('heteroAgent.executionTarget.infoTooltip')}>
              <span className={styles.headerInfo}>
                <Icon icon={InfoIcon} size={12} />
              </span>
            </Tooltip>
          </Flexbox>
          {isDesktop || showWebDownloadCard ? null : (
            <button
              className={styles.headerLink}
              disabled={downloadDisabled || downloading}
              type="button"
              onClick={() => void download()}
            >
              <Icon icon={MonitorDownIcon} size={11} />
              <span>
                {downloadDisabled
                  ? t('productFeatures.disabled', { ns: 'common' })
                  : t('heteroAgent.executionTarget.downloadDesktop')}
              </span>
            </button>
          )}
        </div>
        {isHetero || isDesktop ? null : (
          <OptionRow
            active={isActive('none')}
            desc={t('heteroAgent.executionTarget.noneDesc')}
            icon={<Icon icon={MonitorOffIcon} size={14} />}
            label={t('heteroAgent.executionTarget.none')}
            onClick={() => void handleSelect('none')}
          />
        )}
        {isDesktop ? (
          <OptionRow
            active={isActive('local')}
            icon={<Icon icon={LaptopIcon} size={14} />}
            label={t('heteroAgent.executionTarget.local')}
            desc={
              <>
                <span className={localGatewayConnected ? styles.dotOnline : styles.dotOffline} />
                <span>
                  {localGatewayConnected
                    ? t('heteroAgent.executionTarget.localGatewayConnected')
                    : localGatewayConnecting
                      ? t('heteroAgent.executionTarget.localGatewayConnecting')
                      : t('heteroAgent.executionTarget.localGatewayDisconnected')}
                </span>
              </>
            }
            tag={
              localDeviceName ? (
                <span className={styles.localDeviceName} title={localDeviceName}>
                  {localDeviceName}
                </span>
              ) : undefined
            }
            onClick={() => void handleSelect('local')}
          />
        ) : null}
        <OptionRow
          active={isActive('sandbox')}
          disabled={!isCloudSandboxEnabled}
          icon={<Icon icon={BoxIcon} size={14} />}
          label={t('heteroAgent.executionTarget.sandbox')}
          desc={
            isCloudSandboxEnabled
              ? t('heteroAgent.executionTarget.sandboxDesc')
              : t('heteroAgent.executionTarget.sandboxUnavailableDesc', {
                  defaultValue: 'Cloud sandbox is not configured on the server',
                })
          }
          onClick={() => void handleSelect('sandbox')}
        />
        {selectableDevices.map((d) => renderDeviceRow(d))}
        {hasNoDevices && isLoading ? (
          <div className={styles.empty}>{t('heteroAgent.executionTarget.loading')}</div>
        ) : null}
        {showWebDownloadCard ? (
          <button
            className={styles.downloadCard}
            disabled={downloadDisabled || downloading}
            type="button"
            onClick={() => void download()}
          >
            <div className={styles.optionIcon}>
              <Icon icon={MonitorDownIcon} size={14} />
            </div>
            <div className={styles.optionMeta}>
              <div className={styles.optionTitle}>
                {downloadDisabled
                  ? t('productFeatures.disabled', { ns: 'common' })
                  : t('heteroAgent.executionTarget.downloadDesktopTitle')}
              </div>
              <div className={styles.desc}>
                {downloadDisabled
                  ? t('productFeatures.disabled', { ns: 'common' })
                  : t('heteroAgent.executionTarget.downloadDesktopDesc')}
              </div>
            </div>
          </button>
        ) : null}
        {hasNoDevices && !isLoading && isDesktop ? (
          <div className={styles.empty}>{t('heteroAgent.executionTarget.noDevices')}</div>
        ) : null}
      </Flexbox>
    );

    if (readOnly) {
      return (
        <Tooltip title={t('workspaceRuntime.target.locked')}>
          <span
            aria-label={`${t('heteroAgent.executionTarget.title')}: ${chipLabel}`}
            className={cx(styles.button, styles.readOnly)}
            data-testid="execution-target-readonly"
          >
            {chipIcon}
            <span className={styles.buttonLabel}>{chipLabel}</span>
            <Icon className={styles.readOnlyLock} icon={LockIcon} size={11} />
          </span>
        </Tooltip>
      );
    }

    return (
      <PopoverRoot open={open} onOpenChange={setOpen}>
        <PopoverTriggerElement>
          <button
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={`${t('heteroAgent.executionTarget.title')}: ${chipLabel}`}
            className={styles.button}
            type="button"
          >
            {chipIcon}
            <span className={styles.buttonLabel}>{chipLabel}</span>
            <Icon icon={ChevronDownIcon} size={12} />
          </button>
        </PopoverTriggerElement>
        <PopoverPortal>
          <PopoverPositioner placement="topLeft">
            <PopoverPopup aria-label={t('heteroAgent.executionTarget.title')}>
              <PopoverViewport>{content}</PopoverViewport>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </PopoverRoot>
    );
  },
);

HeteroDeviceSwitcher.displayName = 'HeteroDeviceSwitcher';

export default HeteroDeviceSwitcher;
