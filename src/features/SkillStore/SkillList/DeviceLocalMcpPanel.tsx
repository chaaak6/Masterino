import type {
  DeviceLocalMcpConfig,
  DeviceLocalMcpDraft,
  DeviceLocalMcpServer,
  DeviceLocalMcpTool,
} from '@lobechat/electron-client-ipc';
import { deviceLocalMcpErrors } from '@lobechat/electron-client-ipc';
import { Flexbox, Icon, Input, Text, TextArea } from '@lobehub/ui';
import { Button, DropdownMenu, Select } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Ellipsis, Monitor, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { usePermission } from '@/hooks/usePermission';
import { mutate } from '@/libs/swr';
import { electronKeys } from '@/libs/swr/keys';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { ensureElectronIpc } from '@/utils/electron/ipc';

export interface DeviceLocalMcpPanelProps {
  addOpen?: boolean;
  draft?: DeviceLocalMcpDraft;
  onAdd?: () => void;
  onClose: () => void;
  onEditingChange?: (editing: boolean) => void;
  onSaved?: (server: DeviceLocalMcpServer) => void;
  onSavingChange?: (saving: boolean) => void;
  onUse?: (server: DeviceLocalMcpServer) => void;
  setupServerUrl?: string;
  setupUserId?: string;
  visible?: boolean;
}

const envSchema = z.record(z.string());
const errorReasons = Object.keys(deviceLocalMcpErrors) as (keyof typeof deviceLocalMcpErrors)[];

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
  `,
  details: css`
    & > summary {
      cursor: pointer;
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

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

const DeviceLocalMcpPanelForAccount = ({
  addOpen,
  draft,
  onAdd,
  onClose,
  onEditingChange,
  onSaved,
  onSavingChange,
  onUse,
  userId,
  visible = true,
}: DeviceLocalMcpPanelProps & { userId?: string }) => {
  const { t } = useTranslation('setting');
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const canAdd = canCreate && canEdit;
  const fieldId = useId();
  const form = useRef<HTMLDivElement>(null);
  const formRevision = useRef(0);
  const [servers, setServers] = useState<DeviceLocalMcpServer[]>([]);
  const [name, setName] = useState(draft?.name ?? '');
  const [command, setCommand] = useState(draft?.command ?? '');
  const [args, setArgs] = useState(draft?.args?.join('\n') ?? '');
  const [env, setEnv] = useState(draft?.env ? JSON.stringify(draft.env, null, 2) : '');
  const [tools, setTools] = useState<DeviceLocalMcpTool[]>();
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [operation, setOperation] = useState<'preset' | 'probe' | 'mutation'>();
  const [query, setQuery] = useState('');
  const [preset, setPreset] = useState(
    draft?.name === 'OpenCADStudio' ? 'opencadstudio' : draft || onSaved ? 'custom' : '',
  );
  const [advanced, setAdvanced] = useState(preset === 'custom' || Boolean(draft && !draft.command));
  const [removing, setRemoving] = useState<string>();
  const [loading, setLoading] = useState(!onSaved && !!userId);
  const busy = !!operation;
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [listRevision, setListRevision] = useState(0);
  const [editing, setEditing] = useState<{ identifier: string; names: string[] }>();

  useEffect(() => {
    onEditingChange?.(Boolean(addOpen || editing || removing || busy));
  }, [addOpen, busy, editing, onEditingChange, removing]);

  useEffect(() => {
    if (addOpen) form.current?.scrollIntoView?.({ block: 'nearest' });
  }, [addOpen]);

  useEffect(() => {
    if (!userId || onSaved || !visible) return;
    setLoadError(false);
    setLoading(true);
    let mounted = true;
    Promise.resolve()
      .then(() => ensureElectronIpc().mcp.listDeviceLocalServers({ userId }))
      .then((list: DeviceLocalMcpServer[]) => {
        if (!mounted) return;
        setServers(list);
        setEditing((current) =>
          list.some(({ identifier }) => identifier === current?.identifier) ? current : undefined,
        );
      })
      .catch(() => mounted && setLoadError(true))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [listRevision, onSaved, userId, visible]);

  const resetProbe = useCallback(() => {
    setTools(undefined);
    setEnabledTools([]);
    setError('');
  }, []);

  const buildConfig = (): DeviceLocalMcpConfig | undefined => {
    const config = { args: args.split(/\r?\n/).filter(Boolean), command: command.trim() };
    if (!env.trim()) return config;

    try {
      return { ...config, env: envSchema.parse(JSON.parse(env)) };
    } catch {
      setError(t('deviceLocalMcp.invalidEnv'));
    }
  };

  const run = async (
    action: () => Promise<void>,
    kind: 'preset' | 'probe' | 'mutation' = 'mutation',
  ) => {
    const revision = formRevision.current;
    setOperation(kind);
    setError('');
    try {
      await action();
    } catch (cause) {
      if (kind !== 'mutation' && formRevision.current !== revision) return;
      const message = cause instanceof Error ? cause.message : '';
      const reason = errorReasons.find((key) => message.includes(deviceLocalMcpErrors[key]));
      setError(reason ? t(`deviceLocalMcp.error.${reason}`) : t('deviceLocalMcp.error'));
      if (!onSaved && userId && reason === 'serverUnavailable') {
        try {
          const list: DeviceLocalMcpServer[] = await ensureElectronIpc().mcp.listDeviceLocalServers(
            { userId },
          );
          setServers(list);
          setRemoving((current) =>
            list.some(({ identifier }) => identifier === current) ? current : undefined,
          );
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
    if (!userId || !canAdd) return;
    const config = buildConfig();
    if (!config) return;
    const revision = formRevision.current;
    void run(async () => {
      const discovered: DeviceLocalMcpTool[] = await ensureElectronIpc().mcp.testDeviceLocalServer({
        config,
        userId,
      });
      if (formRevision.current !== revision) return;
      const names = new Set(discovered.map((tool) => tool.name));
      setTools(discovered);
      setEnabledTools((selection) =>
        tools
          ? selection.filter((tool) => names.has(tool))
          : preset === 'opencadstudio' && names.has('ocs_inspect')
            ? ['ocs_inspect']
            : [],
      );
    }, 'probe');
  };

  const resetForm = useCallback(() => {
    formRevision.current += 1;
    setPreset('');
    setName('');
    setCommand('');
    setArgs('');
    setEnv('');
    setAdvanced(false);
    resetProbe();
    onClose();
  }, [onClose, resetProbe]);

  useEffect(() => {
    if (!visible && addOpen && operation !== 'mutation') resetForm();
  }, [addOpen, operation, resetForm, visible]);

  const selectPreset = (value: string) => {
    setPreset(value);
    setName('');
    setCommand('');
    setArgs('');
    setEnv('');
    resetProbe();
    setAdvanced(value === 'custom');
    if (value === 'opencadstudio') {
      const revision = formRevision.current;
      void run(async () => {
        const preset = await ensureElectronIpc().mcp.resolveDeviceLocalMcpPreset('opencadstudio');
        if (formRevision.current !== revision) return;
        setName(preset.name);
        setCommand(preset.command);
        setArgs(preset.args?.join('\n') ?? '');
        setEnv(preset.env ? JSON.stringify(preset.env, null, 2) : '');
        if (!preset.command) setAdvanced(true);
      }, 'preset');
    }
  };

  const save = () => {
    if (!userId || !canAdd) return;
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
      setQuery('');
      resetForm();
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

  const removeServer = (identifier: string) => {
    if (!userId) return;
    void run(async () => {
      await ensureElectronIpc().mcp.removeDeviceLocalServer({ identifier, userId });
      setServers((current) => current.filter((item) => item.identifier !== identifier));
      setEditing((current) => (current?.identifier === identifier ? undefined : current));
      setRemoving(undefined);
      setListRevision((revision) => revision + 1);
    });
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleServers = servers.filter((server) =>
    server.name.toLowerCase().includes(normalizedQuery),
  );

  return (
    <Flexbox gap={12} paddingInline={16} style={{ paddingBlock: 8 }}>
      {!onSaved && (
        <>
          <Flexbox horizontal align="center" gap={8}>
            <Input
              allowClear
              aria-label={t('deviceLocalMcp.search')}
              placeholder={t('deviceLocalMcp.search')}
              prefix={<Icon icon={Search} />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              aria-controls={`${fieldId}-form`}
              aria-expanded={Boolean(addOpen)}
              disabled={!userId || !canAdd || busy || loading || addOpen}
              icon={<Icon icon={Plus} size={16} />}
              onClick={onAdd}
            >
              {t('deviceLocalMcp.add')}
            </Button>
          </Flexbox>
          {!userId && <Text type="secondary">{t('deviceLocalMcp.error.account')}</Text>}
          {loading && <Text type="secondary">{t('loading', { ns: 'common' })}</Text>}
          {loadError && (
            <Flexbox horizontal align="center" gap={8} role="alert">
              {t('deviceLocalMcp.loadError')}
              <Button size="small" onClick={() => setListRevision((revision) => revision + 1)}>
                {t('retry', { ns: 'common' })}
              </Button>
            </Flexbox>
          )}
          {userId && !loading && !loadError && visibleServers.length === 0 && (
            <Text type="secondary">
              {t(normalizedQuery ? 'deviceLocalMcp.noMatches' : 'deviceLocalMcp.empty')}
            </Text>
          )}
          {visibleServers.map((server) => (
            <Flexbox className={styles.card} gap={8} key={server.identifier}>
              <Flexbox horizontal align="center" gap={10}>
                <Icon icon={Monitor} size={22} />
                <Flexbox flex={1} gap={2}>
                  <strong>{server.name}</strong>
                  <Text type="secondary">
                    {t('deviceLocalMcp.thisDevice')} ·{' '}
                    {server.enabled
                      ? t('deviceLocalMcp.enabledRatio', {
                          count: server.enabledTools.length,
                          total: server.tools.length,
                        })
                      : t('deviceLocalMcp.disabled')}
                  </Text>
                </Flexbox>
                {onUse && server.enabled && server.enabledTools.length > 0 && (
                  <Button disabled={busy} size="small" onClick={() => onUse(server)}>
                    {t('deviceLocalMcp.useThisTurn')}
                  </Button>
                )}
                <DropdownMenu
                  placement="bottomRight"
                  items={[
                    {
                      key: 'edit',
                      label: t('deviceLocalMcp.editTools'),
                      onClick: () => {
                        setRemoving(undefined);
                        setEditing({ identifier: server.identifier, names: server.enabledTools });
                      },
                    },
                    {
                      key: 'toggle',
                      label: t(server.enabled ? 'deviceLocalMcp.disable' : 'deviceLocalMcp.enable'),
                      onClick: () => updateServer(server, !server.enabled),
                    },
                    {
                      danger: true,
                      key: 'remove',
                      label: t('delete', { ns: 'common' }),
                      onClick: () => {
                        setEditing(undefined);
                        setRemoving(server.identifier);
                      },
                    },
                  ]}
                >
                  <Button
                    aria-label={t('deviceLocalMcp.manage', { name: server.name })}
                    disabled={busy || !canEdit}
                    icon={<Icon icon={Ellipsis} size={16} />}
                    size="small"
                    type="text"
                  />
                </DropdownMenu>
              </Flexbox>
              {removing === server.identifier && (
                <Flexbox horizontal align="center" gap={8} wrap="wrap">
                  <span>{t('deviceLocalMcp.removeConfirm', { name: server.name })}</span>
                  <Button disabled={busy} size="small" onClick={() => setRemoving(undefined)}>
                    {t('cancel', { ns: 'common' })}
                  </Button>
                  <Button
                    danger
                    disabled={busy}
                    size="small"
                    onClick={() => removeServer(server.identifier)}
                  >
                    {t('delete', { ns: 'common' })}
                  </Button>
                </Flexbox>
              )}
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
        </>
      )}
      {error && <div role="alert">{error}</div>}
      {addOpen && (
        <Flexbox className={styles.card} gap={12} id={`${fieldId}-form`} ref={form}>
          <strong>{t('deviceLocalMcp.add')}</strong>
          {!canAdd && <Text type="secondary">{t('workspace.general.noPermissionHint')}</Text>}
          {onSaved && <Text type="secondary">{t('deviceLocalMcp.chatSetup')}</Text>}
          <Text type="secondary">{t('deviceLocalMcp.description')}</Text>
          <Flexbox horizontal align="end" gap={8} wrap="wrap">
            <Flexbox flex={1} gap={4}>
              <label htmlFor={`${fieldId}-preset`}>{t('deviceLocalMcp.preset')}</label>
              <Select
                disabled={busy || !canAdd || Boolean(onSaved)}
                id={`${fieldId}-preset`}
                placeholder={t('deviceLocalMcp.choosePreset')}
                value={preset || null}
                options={[
                  { label: 'OpenCADStudio', value: 'opencadstudio' },
                  { label: t('deviceLocalMcp.customPreset'), value: 'custom' },
                ]}
                onChange={(value) => {
                  if (typeof value === 'string') selectPreset(value);
                }}
              />
            </Flexbox>
            <Button
              disabled={busy || !userId || !canAdd || !command.trim()}
              loading={operation === 'probe'}
              onClick={testConnection}
            >
              {t('deviceLocalMcp.test')}
            </Button>
          </Flexbox>
          {!!preset && (
            <details
              className={styles.details}
              open={advanced}
              onToggle={(event) => setAdvanced(event.currentTarget.open)}
            >
              <summary>{t('deviceLocalMcp.advanced')}</summary>
              <Flexbox gap={8} style={{ paddingBlockStart: 8 }}>
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
              </Flexbox>
            </details>
          )}
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
          <Flexbox horizontal gap={8} justify="end">
            <Button disabled={operation === 'mutation'} onClick={onSaved ? onClose : resetForm}>
              {t('cancel', { ns: 'common' })}
            </Button>
            <Button
              disabled={
                busy || loading || !userId || !canAdd || !name.trim() || enabledTools.length === 0
              }
              loading={operation === 'mutation'}
              type="primary"
              onClick={save}
            >
              {t('deviceLocalMcp.save')}
            </Button>
          </Flexbox>
        </Flexbox>
      )}
      {servers.some((server) => server.enabled) && (
        <Text type="secondary">{t('deviceLocalMcp.useInChat', { menu: t('tools.title') })}</Text>
      )}
    </Flexbox>
  );
};

const DeviceLocalMcpPanel = (props: DeviceLocalMcpPanelProps) => {
  const userId = useUserStore(userProfileSelectors.userId);
  const serverUrl = useElectronStore(electronSyncSelectors.remoteServerUrl);
  const { onClose, setupServerUrl, setupUserId } = props;
  const accountChanged = Boolean(
    setupUserId && (setupUserId !== userId || setupServerUrl !== serverUrl),
  );

  useEffect(() => {
    if (accountChanged) onClose();
  }, [accountChanged, onClose]);

  if (accountChanged) return null;
  return (
    <DeviceLocalMcpPanelForAccount
      key={JSON.stringify([serverUrl, userId])}
      {...props}
      userId={userId}
    />
  );
};

export default DeviceLocalMcpPanel;
