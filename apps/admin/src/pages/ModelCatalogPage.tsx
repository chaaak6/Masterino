import { trpc } from '@admin/lib/trpc';
import {
  createEmptyModelDescription,
  type ManagedModelRecord,
  type ManagedModelRevision,
} from '@lobechat/types';
import { MotionProvider, ThemeProvider } from '@lobehub/ui';
import { Button, Modal, Switch, toast, ToastHost } from '@lobehub/ui/base-ui';
import { Alert, Card, Descriptions, Empty, Input, Space, Table, Tag, Typography } from 'antd';
import { motion } from 'motion/react';
import { useState } from 'react';

import ModelCatalogEditor, { capabilityLabels } from './ModelCatalogEditor';

type Row = { modelId: string; record?: ManagedModelRecord; discovered: boolean };
const needsMoreInformation = (record?: ManagedModelRecord) => {
  const value = record?.published;
  return (
    !value ||
    !value.description ||
    value.kind === 'unknown' ||
    (value.kind === 'chat' &&
      (value.contextWindowTokens === null ||
        value.maxOutput === null ||
        value.inputModalities.text === 'unknown' ||
        value.inputModalities.image === 'unknown'))
  );
};

export default function ModelCatalogPage() {
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [editing, setEditing] = useState<Row>();
  const [preview, setPreview] = useState<Row>();
  const [publishing, setPublishing] = useState<{ row: Row; revision?: string }>();
  const [historyId, setHistoryId] = useState('');
  const [reason, setReason] = useState('');
  const utils = trpc.useUtils();
  const list = trpc.modelCatalog.list.useQuery();
  const discover = trpc.modelCatalog.discover.useQuery(undefined, { retry: false });
  const history = trpc.modelCatalog.history.useQuery(
    { modelId: historyId },
    { enabled: !!historyId },
  );
  const pricing = trpc.modelCatalog.pricing.useQuery(
    { modelId: preview?.modelId ?? '' },
    { enabled: !!preview, retry: false },
  );
  const onError = (error: { message: string }) => toast.error(error.message);
  const refresh = () => utils.modelCatalog.list.invalidate();
  const save = trpc.modelCatalog.saveDraft.useMutation({
    onError,
    onSuccess: async () => {
      setEditing(undefined);
      await refresh();
      toast.success('草稿已保存，发布后生效');
    },
  });
  const publish = trpc.modelCatalog.publish.useMutation({
    onError,
    onSuccess: async () => {
      setPublishing(undefined);
      await refresh();
      toast.success('模型说明已发布');
    },
  });
  const rollback = trpc.modelCatalog.rollback.useMutation({
    onError,
    onSuccess: async () => {
      setPublishing(undefined);
      setHistoryId('');
      await refresh();
      toast.success('已回滚，并生成新的发布版本');
    },
  });
  const settings = trpc.modelCatalog.updateSettings.useMutation({ onError, onSuccess: refresh });
  const records = new Map(list.data?.records.map((record) => [record.modelId, record]));
  const ids = [...new Set([...records.keys(), ...(discover.data ?? [])])].sort();
  const rows: Row[] = ids
    .filter((id) => {
      const record = records.get(id);
      return (
        (!onlyMissing || needsMoreInformation(record)) &&
        `${id} ${record?.draft.displayName ?? ''} ${record?.published?.displayName ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase())
      );
    })
    .map((modelId) => ({
      modelId,
      record: records.get(modelId),
      discovered: discover.data?.includes(modelId) ?? false,
    }));
  const description = preview?.record?.draft;
  return (
    <ThemeProvider
      appearance="light"
      customTheme={{ primaryColor: 'blue' }}
      enableGlobalStyle={false}
    >
      <MotionProvider motion={motion}>
        <ToastHost duration={2500} limit={3} position="top" />
        <>
          <Typography.Title level={3}>模型说明维护</Typography.Title>
          <Typography.Paragraph type="secondary">
            维护模型能力、容量和使用说明。发布后客户端可读取；调用权限和实际扣费仍由 Aihub 决定。
          </Typography.Paragraph>
          {list.error ? (
            <Alert
              showIcon
              action={<Button onClick={() => void list.refetch()}>重试</Button>}
              description={list.error.message}
              message="模型目录加载失败"
              type="error"
            />
          ) : (
            <>
              <Card size="small" style={{ marginBottom: 16 }}>
                <Space wrap size="large">
                  <Space>
                    <Switch
                      checked={list.data?.settings.enabled ?? false}
                      disabled={!list.data || settings.isPending}
                      onChange={(enabled) =>
                        settings.mutate({
                          enabled,
                          silentRefreshEnabled: list.data!.settings.silentRefreshEnabled,
                        })
                      }
                    />
                    <span>应用已发布模型说明</span>
                  </Space>
                  <Space>
                    <Switch
                      checked={list.data?.settings.silentRefreshEnabled ?? false}
                      disabled={!list.data || settings.isPending}
                      onChange={(silentRefreshEnabled) =>
                        settings.mutate({
                          silentRefreshEnabled,
                          enabled: list.data!.settings.enabled,
                        })
                      }
                    />
                    <span>客户端静默刷新</span>
                  </Space>
                </Space>
                <Typography.Paragraph style={{ marginBottom: 0, marginTop: 8 }} type="secondary">
                  进入主界面后检查一次，之后每 30 分钟检查。关闭静默刷新可回退到原有手动刷新流程。
                </Typography.Paragraph>
              </Card>
              {discover.error && (
                <Alert
                  showIcon
                  description={discover.error.message}
                  message="暂时无法发现上游模型，已维护的说明仍可编辑"
                  style={{ marginBottom: 16 }}
                  type="warning"
                />
              )}
              <Space wrap style={{ marginBottom: 16 }}>
                <Input
                  aria-label="搜索模型"
                  placeholder="搜索模型 ID 或名称"
                  style={{ width: 280 }}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button onClick={() => setOnlyMissing(!onlyMissing)}>
                  {onlyMissing ? '显示全部' : '只看待完善'}
                </Button>
                <Button loading={discover.isFetching} onClick={() => void discover.refetch()}>
                  发现模型
                </Button>
              </Space>
              <Table<Row>
                dataSource={rows}
                loading={list.isLoading}
                locale={{ emptyText: <Empty description="暂无模型，请先发现上游模型" /> }}
                pagination={{ pageSize: 20 }}
                rowKey="modelId"
                scroll={{ x: 850 }}
                columns={[
                  {
                    title: '模型',
                    dataIndex: 'modelId',
                    render: (_, row) => (
                      <>
                        <Typography.Text strong>
                          {row.record?.published?.displayName ??
                            row.record?.draft.displayName ??
                            row.modelId}
                        </Typography.Text>
                        <div>
                          <Typography.Text type="secondary">{row.modelId}</Typography.Text>
                        </div>
                      </>
                    ),
                  },
                  {
                    title: '说明状态',
                    render: (_, row) => (
                      <Space>
                        <Tag color={row.record?.published ? 'green' : 'orange'}>
                          {row.record?.published ? '已发布' : row.record ? '草稿' : '待完善'}
                        </Tag>
                        {row.record?.published && needsMoreInformation(row.record) && (
                          <Tag>资料待完善</Tag>
                        )}
                        {row.record?.published &&
                          JSON.stringify(row.record.draft) !==
                            JSON.stringify(row.record.published) && <Tag>有草稿修改</Tag>}
                      </Space>
                    ),
                  },
                  {
                    title: '上游发现',
                    render: (_, row) =>
                      row.discovered ? '已发现' : discover.error ? '未知' : '本次未发现',
                  },
                  {
                    title: '上下文',
                    render: (_, row) =>
                      row.record?.published?.contextWindowTokens?.toLocaleString() ?? '待确认',
                  },
                  {
                    title: '操作',
                    render: (_, row) => (
                      <Space wrap>
                        <Button aria-label="维护" size="small" onClick={() => setEditing(row)}>
                          维护
                        </Button>
                        <Button
                          aria-label="预览"
                          disabled={!row.record}
                          size="small"
                          onClick={() => setPreview(row)}
                        >
                          预览
                        </Button>
                        <Button
                          aria-label="发布"
                          disabled={!row.record}
                          size="small"
                          onClick={() => {
                            setReason('');
                            setPublishing({ row });
                          }}
                        >
                          发布
                        </Button>
                        <Button
                          aria-label="历史"
                          disabled={!row.record?.published}
                          size="small"
                          onClick={() => setHistoryId(row.modelId)}
                        >
                          历史
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </>
          )}
          {editing && (
            <ModelCatalogEditor
              initial={editing.record?.draft ?? createEmptyModelDescription(editing.modelId)}
              key={editing.modelId}
              modelId={editing.modelId}
              record={editing.record}
              saving={save.isPending}
              onClose={() => setEditing(undefined)}
              onSave={(draft) =>
                save.mutate({
                  modelId: editing.modelId,
                  expectedVersion: editing.record?.version ?? 0,
                  draft,
                })
              }
            />
          )}
          <Modal
            open={!!preview}
            title={`草稿预览 · ${preview?.modelId}`}
            width={650}
            footer={
              <Button aria-label="关闭" onClick={() => setPreview(undefined)}>
                关闭
              </Button>
            }
            onCancel={() => setPreview(undefined)}
          >
            {description && (
              <Descriptions
                column={1}
                items={[
                  { key: 'name', label: '展示名称', children: description.displayName },
                  {
                    key: 'description',
                    label: '简介',
                    children: description.description || '未填写',
                  },
                  {
                    key: 'context',
                    label: '上下文',
                    children: description.contextWindowTokens?.toLocaleString() ?? '待确认',
                  },
                  {
                    key: 'output',
                    label: '最大输出',
                    children: description.maxOutput?.toLocaleString() ?? '待确认',
                  },
                  { key: 'limits', label: '限制', children: description.limitations || '未填写' },
                  {
                    key: 'abilities',
                    label: '能力',
                    children: (
                      <Space wrap>
                        {(['text', 'image', 'functionCall'] as const).map((key) => (
                          <Tag key={key}>
                            {capabilityLabels[key]}：
                            {(key === 'functionCall'
                              ? description.capabilities.functionCall
                              : description.inputModalities[key]) === 'supported'
                              ? '支持'
                              : (key === 'functionCall'
                                    ? description.capabilities.functionCall
                                    : description.inputModalities[key]) === 'unsupported'
                                ? '不支持'
                                : '待确认'}
                          </Tag>
                        ))}
                      </Space>
                    ),
                  },
                  {
                    key: 'price',
                    label: 'Aihub 公共计费价',
                    children: pricing.isFetching ? (
                      '读取中…'
                    ) : pricing.error ? (
                      <Space>
                        <Typography.Text type="danger">价格读取失败</Typography.Text>
                        <Button onClick={() => void pricing.refetch()}>重试</Button>
                      </Space>
                    ) : pricing.data?.status !== 'available' ? (
                      '暂无可靠价格'
                    ) : (
                      <Space direction="vertical">
                        {Object.entries(pricing.data.displayRates ?? {}).map(([unit, range]) => (
                          <span key={unit}>
                            {
                              (
                                {
                                  input: '输入',
                                  output: '输出',
                                  cacheRead: '缓存读取',
                                  cacheWrite: '缓存写入',
                                  request: '按次',
                                } as Record<string, string>
                              )[unit]
                            }
                            ：¥{range.min}
                            {range.max !== range.min ? `–${range.max}` : ''} /{' '}
                            {unit === 'request' ? '次' : '百万 tokens'}
                          </span>
                        ))}
                        <Typography.Text type="secondary">
                          公共基准价，用户实际价格可能受账户倍率影响。
                        </Typography.Text>
                      </Space>
                    ),
                  },
                  {
                    key: 'reference',
                    label: '参考价',
                    children: description.referencePricing
                      ? `${description.referencePricing.currency} · 输入 ${description.referencePricing.input ?? '待确认'} / 输出 ${description.referencePricing.output ?? '待确认'}，每百万 tokens；来源：${description.referencePricing.source}`
                      : '未维护',
                  },
                ]}
              />
            )}
          </Modal>
          <Modal
            cancelText="取消"
            confirmLoading={publish.isPending || rollback.isPending}
            okButtonProps={{ disabled: !reason.trim() }}
            okText={publishing?.revision ? '确认回滚' : '确认发布'}
            open={!!publishing}
            title={publishing?.revision ? '回滚模型说明' : '发布模型说明'}
            onCancel={() => setPublishing(undefined)}
            onOk={() => {
              if (!publishing?.row.record) return;
              const input = {
                modelId: publishing.row.modelId,
                expectedVersion: publishing.row.record.version,
                reason: reason.trim(),
              };
              publishing.revision
                ? rollback.mutate({ ...input, revision: publishing.revision })
                : publish.mutate(input);
            }}
          >
            <Typography.Paragraph>
              影响后续读取此模型的客户端，不改变用户调用权限或正在运行任务的能力快照。
            </Typography.Paragraph>
            <Input.TextArea
              aria-label="变更原因"
              maxLength={2000}
              placeholder="填写变更原因"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Modal>
          <Modal
            footer={<Button onClick={() => setHistoryId('')}>关闭</Button>}
            open={!!historyId}
            title={`发布历史 · ${historyId}`}
            width={800}
            onCancel={() => setHistoryId('')}
          >
            {history.error && (
              <Alert
                action={<Button onClick={() => void history.refetch()}>重试</Button>}
                message="历史加载失败"
                type="error"
              />
            )}
            <Table<ManagedModelRevision>
              dataSource={history.data ?? []}
              loading={history.isLoading}
              pagination={{ pageSize: 10 }}
              rowKey="id"
              columns={[
                {
                  title: '时间',
                  render: (_, row) => new Date(row.createdAt).toLocaleString('zh-CN'),
                },
                { title: '名称', render: (_, row) => row.description.displayName },
                { title: '原因', dataIndex: 'reason' },
                {
                  title: '操作',
                  render: (_, row) => (
                    <Button
                      disabled={records.get(historyId)?.publishedRevision === row.id}
                      onClick={() => {
                        setReason('');
                        setPublishing({
                          row: {
                            modelId: historyId,
                            record: records.get(historyId),
                            discovered: false,
                          },
                          revision: row.id,
                        });
                      }}
                    >
                      回滚到此版本
                    </Button>
                  ),
                },
              ]}
            />
          </Modal>
        </>
      </MotionProvider>
    </ThemeProvider>
  );
}
