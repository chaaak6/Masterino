import type {
  DeviceLocalMcpConfig,
  DeviceLocalMcpServer,
  DeviceLocalMcpTool,
} from '@lobechat/electron-client-ipc';
import { Button, Flexbox, Input, TextArea } from '@lobehub/ui';
import { confirmModal, Modal } from '@lobehub/ui/base-ui';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { ensureElectronIpc } from '@/utils/electron/ipc';

interface DeviceLocalMcpModalProps {
  onClose: () => void;
}

const DeviceLocalMcpModal = ({ onClose }: DeviceLocalMcpModalProps) => {
  const { t } = useTranslation('setting');
  const userId = useUserStore(userProfileSelectors.userId);
  const fieldId = useId();
  const [servers, setServers] = useState<DeviceLocalMcpServer[]>([]);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState('');
  const [tools, setTools] = useState<DeviceLocalMcpTool[]>();
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    ensureElectronIpc()
      .mcp.listDeviceLocalServers({ userId })
      .then((list: DeviceLocalMcpServer[]) => mounted && setServers(list))
      .catch(() => mounted && setError(t('deviceLocalMcp.error')));
    return () => {
      mounted = false;
    };
  }, [t, userId]);

  const resetProbe = () => {
    setTools(undefined);
    setEnabledTools([]);
    setError('');
  };

  const buildConfig = (): DeviceLocalMcpConfig => ({
    args: args.split(/\r?\n/).filter(Boolean),
    command: command.trim(),
    env: env.trim() ? JSON.parse(env) : undefined,
  });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError(t('deviceLocalMcp.error'));
    } finally {
      setBusy(false);
    }
  };

  const testConnection = () => {
    resetProbe();
    void run(async () => {
      const discovered = await ensureElectronIpc().mcp.testDeviceLocalServer(buildConfig());
      setTools(discovered);
    });
  };

  const save = () => {
    if (!userId) return;
    void run(async () => {
      const server = await ensureElectronIpc().mcp.saveDeviceLocalServer({
        config: buildConfig(),
        enabledTools,
        name,
        userId,
      });
      setServers((current) => [...current, server]);
      setName('');
      setCommand('');
      setArgs('');
      setEnv('');
      resetProbe();
    });
  };

  return (
    <Modal
      open
      cancelText={t('close', { ns: 'common' })}
      confirmLoading={busy}
      okButtonProps={{ disabled: !userId || !name.trim() || enabledTools.length === 0 }}
      okText={t('deviceLocalMcp.save')}
      title={t('deviceLocalMcp.title')}
      onCancel={onClose}
      onOk={save}
    >
      <Flexbox gap={16}>
        <div>{t('deviceLocalMcp.description')}</div>
        {servers.map((server) => (
          <Flexbox
            horizontal
            align="center"
            gap={8}
            justify="space-between"
            key={server.identifier}
          >
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
                  userId &&
                  void run(async () => {
                    const enabled = !server.enabled;
                    await ensureElectronIpc().mcp.updateDeviceLocalServer({
                      enabled,
                      identifier: server.identifier,
                      userId,
                    });
                    setServers((current) =>
                      current.map((item) =>
                        item.identifier === server.identifier ? { ...item, enabled } : item,
                      ),
                    );
                  })
                }
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
                      }),
                  })
                }
              >
                {t('delete', { ns: 'common' })}
              </Button>
            </Flexbox>
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
          {error && <div role="alert">{error}</div>}
        </Flexbox>
        {tools && (
          <Flexbox gap={6}>
            <strong>{t('deviceLocalMcp.discovered', { count: tools.length })}</strong>
            <Flexbox gap={4} style={{ maxHeight: 156, overflowY: 'auto' }}>
              {tools.map(({ description, name }) => (
                <label key={name} title={description}>
                  <input
                    checked={enabledTools.includes(name)}
                    disabled={busy}
                    type="checkbox"
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setEnabledTools((current) =>
                        checked ? [...current, name] : current.filter((item) => item !== name),
                      );
                    }}
                  />{' '}
                  {name}
                </label>
              ))}
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    </Modal>
  );
};

export default DeviceLocalMcpModal;
