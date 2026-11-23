import type {
  DeviceLocalMcpConfig,
  DeviceLocalMcpDraft,
  DeviceLocalMcpServer,
  DeviceLocalMcpTool,
} from '@lobechat/electron-client-ipc';
import { deviceLocalMcpErrors } from '@lobechat/electron-client-ipc';
import { Flexbox, Input, TextArea } from '@lobehub/ui';
import { Button, confirmModal, Modal } from '@lobehub/ui/base-ui';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { mutate } from '@/libs/swr';
import { electronKeys } from '@/libs/swr/keys';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { ensureElectronIpc } from '@/utils/electron/ipc';

interface DeviceLocalMcpModalProps {
  draft?: DeviceLocalMcpDraft;
  onClose: () => void;
  onSaved?: (server: DeviceLocalMcpServer) => void;
  onSavingChange?: (saving: boolean) => void;
  setupUserId?: string;
}

const envSchema = z.record(z.string());
const errorReasons = Object.keys(deviceLocalMcpErrors) as (keyof typeof deviceLocalMcpErrors)[];

const ToolSelection = ({
  disabled,
  onChange,
  selected,
  tools,
}: {
  disabled: boolean;
  onChange: (names: string[]) => void;
  selected: string[];
  tools: DeviceLocalMcpTool[];
}) => (
  <Flexbox gap={4} style={{ maxHeight: 156, overflowY: 'auto' }}>
    {tools.map(({ description, name }) => (
      <label key={name} title={description}>
        <input
          checked={selected.includes(name)}
          disabled={disabled}
          type="checkbox"
          onChange={(event) =>
            onChange(
              event.target.checked ? [...selected, name] : selected.filter((item) => item !== name),
            )
          }
        />{' '}
        {name}
      </label>
    ))}
  </Flexbox>
);

const DeviceLocalMcpModalForAccount = ({
  draft,
  onClose,
  onSaved,
  onSavingChange,
  userId,
}: DeviceLocalMcpModalProps & { userId?: string }) => {
  const { t } = useTranslation('setting');
  const fieldId = useId();
  const [servers, setServers] = useState<DeviceLocalMcpServer[]>([]);
  const [name, setName] = useState(draft?.name ?? '');
  const [command, setCommand] = useState(draft?.command ?? '');
  const [args, setArgs] = useState(draft?.args?.join('\n') ?? '');
  const [env, setEnv] = useState(draft?.env ? JSON.stringify(draft.env, null, 2) : '');
  const [tools, setTools] = useState<DeviceLocalMcpTool[]>();
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [operation, setOperation] = useState<'probe' | 'mutation'>();
  const busy = !!operation;
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [listRevision, setListRevision] = useState(0);
  const [editing, setEditing] = useState<{ identifier: string; names: string[] }>();

  useEffect(() => {
    setServers([]);
    setEditing(undefined);
    setLoadError(false);
    if (!userId || onSaved) return;
    let mounted = true;
    Promise.resolve()
      .then(() => ensureElectronIpc().mcp.listDeviceLocalServers({ userId }))
      .then((list: DeviceLocalMcpServer[]) => mounted && setServers(list))
      .catch(() => mounted && setLoadError(true));
    return () => {
      mounted = false;
    };
  }, [listRevision, onSaved, userId]);

  const resetProbe = () => {
    setTools(undefined);
    setEnabledTools([]);
    setError('');
  };

  const buildConfig = (): DeviceLocalMcpConfig | undefined => {
    const config = { args: args.split(/\r?\n/).filter(Boolean), command: command.trim() };
    if (!env.trim()) return config;

    try {
      return { ...config, env: envSchema.parse(JSON.parse(env)) };
    } catch {
      setError(t('deviceLocalMcp.invalidEnv'));
    }
  };

  const run = async (action: () => Promise<void>, kind: 'probe' | 'mutation' = 'mutation') => {
    setOperation(kind);
    setError('');
    try {
      await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      const reason = errorReasons.find((key) => message.includes(deviceLocalMcpErrors[key]));
      setError(reason ? t(`deviceLocalMcp.error.${reason}`) : t('deviceLocalMcp.error'));
      if (!onSaved && userId && reason === 'serverUnavailable') {
        try {
          const list: DeviceLocalMcpServer[] = await ensureElectronIpc().mcp.listDeviceLocalServers(
            { userId },
          );
          setServers(list);
          setEditing((current) =>
            list.some(({ identifier }) => identifier === current?.identifier) ? current : undefined,
          );
        } catch {
          setLoadError(true);
        }
      } else if (!onSaved && reason === 'stopFailed') {
        setListRevision((revision) => revision + 1);
      }
    } finally {
      if (kind === 'mutation' && userId) {
        void mutate(
          (key) =>
            Array.isArray(key) && key[0] === electronKeys.deviceLocalMcp.root && key[1] === userId,
          undefined,
          { revalidate: true },
        ).catch(() => {});
      }
      setOperation(undefined);
    }
  };

  const testConnection = () => {
    if (!userId) return;
    const config = buildConfig();
    if (!config) return;
    void run(async () => {
      const discovered: DeviceLocalMcpTool[] = await ensureElectronIpc().mcp.testDeviceLocalServer({
        config,
        userId,
      });
      const names = new Set(discovered.map((tool) => tool.name));
      setTools(discovered);
      setEnabledTools((selection) =>
        tools
          ? selection.filter((tool) => names.has(tool))
          : draft?.name === 'OpenCADStudio' && names.has('ocs_inspect')
            ? ['ocs_inspect']
            : [],
      );
    }, 'probe');
  };

  const save = () => {
    if (!userId) return;
    const config = buildConfig();
    if (!config) return;
    onSavingChange?.(true);
    void run(async () => {
      const server = await ensureElectronIpc().mcp.saveDeviceLocalServer({
        config,
        enabledTools,
        name,
        userId,
      });
      if (onSaved) {
        onSaved(server);
        return;
      }
      setServers((current) => [...current, server]);
      setName('');
      setCommand('');
      setArgs('');
      setEnv('');
      resetProbe();
    }).finally(() => onSavingChange?.(false));
  };

  const updateServer = (server: DeviceLocalMcpServer, enabled: boolean, selection?: string[]) => {
    if (!userId) return;
    void run(async () => {
      const updated: DeviceLocalMcpServer = await ensureElectronIpc().mcp.updateDeviceLocalServer({
        enabled,
        enabledTools: selection,
        identifier: server.identifier,
        userId,
      });
      setServers((current) =>
        current.map((item) => (item.identifier === updated.identifier ? updated : item)),
      );
      if (selection) setEditing(undefined);
    });
  };

  return (
    <Modal
      open
      cancelButtonProps={{ disabled: operation === 'mutation' }}
      cancelText={t('close', { ns: 'common' })}
      confirmLoading={busy}
      okButtonProps={{ disabled: !userId || !name.trim() || enabledTools.length === 0 }}
      okText={t('deviceLocalMcp.save')}
      title={t('deviceLocalMcp.title')}
      onOk={save}
      onCancel={() => {
        if (operation !== 'mutation') onClose();
      }}
    >
      <Flexbox gap={16}>
        <div>{t('deviceLocalMcp.description')}</div>
        {servers.some((server) => server.enabled) && <div>{t('deviceLocalMcp.useInChat')}</div>}
        {onSaved && <div>{t('deviceLocalMcp.chatSetup')}</div>}
        {loadError && <div role="alert">{t('deviceLocalMcp.loadError')}</div>}
        {!onSaved &&
          servers.map((server) => (
            <Flexbox gap={8} key={server.identifier}>
              <Flexbox horizontal align="center" gap={8} justify="space-between">
                <div>
                  <strong>{server.name}</strong>
                  <div>
                    {t('deviceLocalMcp.enabledCount', {
                      count: server.enabled ? server.enabledTools.length : 0,
                    })}
                  </div>
                </div>
                <Flexbox horizontal gap={8}>
                  <Button
                    disabled={busy}
                    size="small"
                    onClick={() =>
                      setEditing({ identifier: server.identifier, names: server.enabledTools })
                    }
                  >
                    {t('deviceLocalMcp.editTools')}
                  </Button>
                  <Button
                    disabled={busy}
                    size="small"
                    onClick={() => updateServer(server, !server.enabled)}
                  >
                    {t(server.enabled ? 'deviceLocalMcp.disable' : 'deviceLocalMcp.enable')}
                  </Button>
                  <Button
                    danger
                    disabled={busy}
                    size="small"
                    onClick={() =>
                      userId &&
                      confirmModal({
                        title: t('deviceLocalMcp.removeConfirm', { name: server.name }),
                        onOk: () =>
                          run(async () => {
                            await ensureElectronIpc().mcp.removeDeviceLocalServer({
                              identifier: server.identifier,
                              userId,
                            });
                            setServers((current) =>
                              current.filter((item) => item.identifier !== server.identifier),
                            );
                            setEditing((current) =>
                              current?.identifier === server.identifier ? undefined : current,
                            );
                          }),
                      })
                    }
                  >
                    {t('delete', { ns: 'common' })}
                  </Button>
                </Flexbox>
              </Flexbox>
              {editing?.identifier === server.identifier && (
                <Flexbox gap={8}>
                  <ToolSelection
                    disabled={busy}
                    selected={editing.names}
                    tools={server.tools}
                    onChange={(names) => setEditing({ identifier: server.identifier, names })}
                  />
                  <Flexbox horizontal gap={8}>
                    <Button disabled={busy} size="small" onClick={() => setEditing(undefined)}>
                      {t('cancel', { ns: 'common' })}
                    </Button>
                    <Button
                      disabled={busy || editing.names.length === 0}
                      size="small"
                      type="primary"
                      onClick={() => updateServer(server, server.enabled, editing.names)}
                    >
                      {t('deviceLocalMcp.saveTools')}
                    </Button>
                  </Flexbox>
                </Flexbox>
              )}
            </Flexbox>
          ))}
        <Flexbox gap={8}>
          <label htmlFor={`${fieldId}-name`}>{t('deviceLocalMcp.name')}</label>
          <Input
            disabled={busy}
            id={`${fieldId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label htmlFor={`${fieldId}-command`}>{t('deviceLocalMcp.command')}</label>
          <Input
            disabled={busy}
            id={`${fieldId}-command`}
            value={command}
            onChange={(event) => {
              setCommand(event.target.value);
              resetProbe();
            }}
          />
          <label htmlFor={`${fieldId}-args`}>{t('deviceLocalMcp.args')}</label>
          <TextArea
            autoSize
            disabled={busy}
            id={`${fieldId}-args`}
            value={args}
            onChange={(event) => {
              setArgs(event.target.value);
              resetProbe();
            }}
          />
          <label htmlFor={`${fieldId}-env`}>{t('deviceLocalMcp.env')}</label>
          <TextArea
            autoSize
            disabled={busy}
            id={`${fieldId}-env`}
            value={env}
            onChange={(event) => {
              setEnv(event.target.value);
              resetProbe();
            }}
          />
          <Button disabled={busy || !userId || !command.trim()} onClick={testConnection}>
            {t('deviceLocalMcp.test')}
          </Button>
        </Flexbox>
        {error && <div role="alert">{error}</div>}
        {tools && (
          <Flexbox gap={6}>
            <strong>{t('deviceLocalMcp.discovered', { count: tools.length })}</strong>
            <ToolSelection
              disabled={busy}
              selected={enabledTools}
              tools={tools}
              onChange={setEnabledTools}
            />
          </Flexbox>
        )}
      </Flexbox>
    </Modal>
  );
};

const DeviceLocalMcpModal = (props: DeviceLocalMcpModalProps) => {
  const userId = useUserStore(userProfileSelectors.userId);
  const { onClose, setupUserId } = props;
  const accountChanged = !!setupUserId && setupUserId !== userId;

  useEffect(() => {
    if (accountChanged) onClose();
  }, [accountChanged, onClose]);

  if (accountChanged) return null;
  return <DeviceLocalMcpModalForAccount key={userId} {...props} userId={userId} />;
};

export default DeviceLocalMcpModal;
