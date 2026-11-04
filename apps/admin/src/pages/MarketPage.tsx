import { trpc } from '@admin/lib/trpc';
import {
  Button,
  Card,
  Checkbox,
  Collapse,
  Flex,
  Form,
  Input,
  message,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';

const workflowColor: Record<string, string> = {
  approved: 'blue',
  in_review: 'gold',
  published: 'green',
  rejected: 'red',
  scanning: 'cyan',
  submitted: 'default',
};

const JsonView = ({ value }: { value: unknown }) => (
  <pre style={{ margin: 0, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
    {JSON.stringify(value ?? {}, null, 2)}
  </pre>
);

function SkillReviewFiles({ identifier, versionId }: { identifier: string; versionId: number }) {
  const query = trpc.admin.getMarketSkillFiles.useQuery({ identifier, versionId });
  if (query.isLoading) return <Typography.Text>正在读取审核包…</Typography.Text>;
  if (query.error) return <Typography.Text type="danger">{query.error.message}</Typography.Text>;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text copyable>{query.data?.hash}</Typography.Text>
      {query.data?.files.map((file) => (
        <div key={file.path}>
          <Typography.Text strong>
            {file.path} ({file.size} bytes)
          </Typography.Text>
          {file.content !== undefined ? (
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>
              {file.content}
            </pre>
          ) : (
            <Typography.Text type="secondary">
              二进制或大型文件，SHA256: {file.sha256}
            </Typography.Text>
          )}
        </div>
      ))}
    </Space>
  );
}

export default function MarketPage() {
  const utils = trpc.useUtils();
  const reviews = trpc.admin.listMarketReviews.useQuery();
  const resources = trpc.admin.listCatalogResources.useQuery({ page: 1, pageSize: 100 });
  const categories = trpc.admin.listMarketCategories.useQuery();
  const accounts = trpc.admin.listMarketAccounts.useQuery();
  const allowlist = trpc.admin.listMarketConnectorAllowlist.useQuery();
  const audit = trpc.admin.listMarketAudit.useQuery({ limit: 100 });
  const [rejecting, setRejecting] = useState<{
    identifier: string;
    type: any;
    versionId: number;
    workflowState: string;
  }>();
  const [rejectReason, setRejectReason] = useState('');

  const reviewMutation = trpc.admin.reviewMarketResource.useMutation({
    onError: (error) => message.error(error.message),
    onSuccess: async () => {
      message.success('Market 状态已更新');
      setRejecting(undefined);
      setRejectReason('');
      await Promise.all([reviews.refetch(), resources.refetch()]);
    },
  });
  const allowlistMutation = trpc.admin.upsertMarketConnectorAllowlist.useMutation({
    onError: (error) => message.error(error.message),
    onSuccess: async () => {
      message.success('出口白名单已保存');
      await allowlist.refetch();
    },
  });
  const allowlistStatusMutation = trpc.admin.updateMarketConnectorAllowlist.useMutation({
    onError: (error) => message.error(error.message),
    onSuccess: async () => {
      message.success('出口白名单状态已更新');
      await allowlist.refetch();
    },
  });
  const importMutation = trpc.admin.importMarketPackage.useMutation({
    onError: (error) => message.error(error.message),
    onSuccess: async () => {
      message.success('离线包已验签并进入审核队列');
      await Promise.all([reviews.refetch(), utils.admin.listMarketAudit.invalidate()]);
    },
  });
  const rollbackMutation = trpc.admin.rollbackMarketResource.useMutation({
    onError: (error) => message.error(error.message),
    onSuccess: async () => {
      message.success('已回滚到指定版本');
      await resources.refetch();
    },
  });
  const categoryMutation = trpc.admin.upsertMarketCategory.useMutation({
    onError: (error) => message.error(error.message),
    onSuccess: async () => {
      message.success('分类已保存');
      await categories.refetch();
    },
  });
  const roleMutation = trpc.admin.updateMarketAccountRole.useMutation({
    onError: (error) => message.error(error.message),
    onSuccess: async () => {
      message.success('Market 角色已更新');
      await accounts.refetch();
    },
  });

  const act = (
    record: any,
    action: 'scan-start' | 'scan-passed' | 'scan-failed' | 'approve' | 'reject' | 'publish',
  ) =>
    reviewMutation.mutate({
      action,
      identifier: record.identifier,
      type: record.type,
      versionId: record.versionId,
      expectedState: record.workflowState,
    });

  return (
    <>
      <Typography.Title level={3}>内部 Market</Typography.Title>
      <Tabs
        items={[
          {
            children: (
              <Card>
                <Table
                  dataSource={resources.data?.items ?? []}
                  loading={resources.isLoading}
                  rowKey={(record: any) => `${record.type}:${record.identifier}`}
                  columns={[
                    { dataIndex: 'name', title: '资源' },
                    { dataIndex: 'type', title: '类型' },
                    { dataIndex: 'version', title: '当前版本' },
                    { dataIndex: 'category', title: '分类' },
                    {
                      dataIndex: 'status',
                      render: (value) => <Tag>{value}</Tag>,
                      title: '状态',
                    },
                    {
                      render: (_, record: any) => (
                        <Space>
                          <Button
                            danger
                            disabled={record.status !== 'published'}
                            onClick={() =>
                              reviewMutation.mutate({
                                action: 'deprecate',
                                versionId: record.versionId,
                                identifier: record.identifier,
                                type: record.type,
                              })
                            }
                          >
                            下架
                          </Button>
                          <Button
                            onClick={() => {
                              let version = '';
                              Modal.confirm({
                                content: (
                                  <Input
                                    placeholder="例如 1.0.0"
                                    onChange={(event) => (version = event.target.value.trim())}
                                  />
                                ),
                                onOk: () => {
                                  if (!version) throw new Error('请输入版本号');
                                  rollbackMutation.mutate({
                                    identifier: record.identifier,
                                    type: record.type,
                                    version,
                                  });
                                },
                                title: '回滚版本',
                              });
                            }}
                          >
                            回滚
                          </Button>
                        </Space>
                      ),
                      title: '操作',
                    },
                  ]}
                />
              </Card>
            ),
            key: 'resources',
            label: '资源与版本',
          },
          {
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card title="新增或更新分类">
                  <Form
                    layout="inline"
                    onFinish={(value) =>
                      categoryMutation.mutate({
                        ...value,
                        localizations: {},
                        sortOrder:
                          value.sortOrder === undefined ? undefined : Number(value.sortOrder),
                      })
                    }
                  >
                    <Form.Item label="资源类型" name="resourceType" rules={[{ required: true }]}>
                      <Input placeholder="agent" />
                    </Form.Item>
                    <Form.Item label="Slug" name="slug" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item label="排序" name="sortOrder">
                      <Input type="number" />
                    </Form.Item>
                    <Button htmlType="submit" type="primary">
                      保存
                    </Button>
                  </Form>
                </Card>
                <Card title="分类">
                  <Table
                    dataSource={categories.data?.items ?? []}
                    loading={categories.isLoading}
                    rowKey="id"
                    columns={[
                      { dataIndex: 'resource_type', title: '资源类型' },
                      { dataIndex: 'slug', title: 'Slug' },
                      { dataIndex: 'sort_order', title: '排序' },
                    ]}
                  />
                </Card>
                <Card title="Market 角色">
                  <Table
                    dataSource={accounts.data?.items ?? []}
                    loading={accounts.isLoading}
                    rowKey="id"
                    columns={[
                      { dataIndex: 'name', title: '姓名' },
                      { dataIndex: 'email', title: '邮箱' },
                      { dataIndex: 'userId', title: 'Masterino ID' },
                      {
                        dataIndex: 'role',
                        render: (value, record: any) => (
                          <Space>
                            <Tag>{value}</Tag>
                            {(['submitter', 'reviewer', 'admin'] as const)
                              .filter((role) => role !== value)
                              .map((role) => (
                                <Button
                                  key={role}
                                  size="small"
                                  onClick={() =>
                                    roleMutation.mutate({ role, userId: record.userId })
                                  }
                                >
                                  {role}
                                </Button>
                              ))}
                          </Space>
                        ),
                        title: '角色',
                      },
                    ]}
                  />
                </Card>
              </Space>
            ),
            key: 'governance',
            label: '分类与角色',
          },
          {
            children: (
              <Card>
                <Table
                  dataSource={reviews.data?.items ?? []}
                  loading={reviews.isLoading}
                  rowKey={(record) => `${record.type}:${record.identifier}:${record.version}`}
                  columns={[
                    { dataIndex: 'name', title: '资源' },
                    { dataIndex: 'type', title: '类型' },
                    { dataIndex: 'version', title: '版本' },
                    { dataIndex: 'ownerName', title: '投稿人' },
                    {
                      dataIndex: 'workflowState',
                      render: (value) => <Tag color={workflowColor[value]}>{value}</Tag>,
                      title: '状态',
                    },
                    {
                      render: (_, record: any) => (
                        <Space wrap>
                          {record.workflowState === 'submitted' && (
                            <Button onClick={() => act(record, 'scan-start')}>开始扫描</Button>
                          )}
                          {record.workflowState === 'scanning' && (
                            <Button onClick={() => act(record, 'scan-passed')}>扫描通过</Button>
                          )}
                          {record.workflowState === 'scanning' && (
                            <Button danger onClick={() => act(record, 'scan-failed')}>
                              扫描失败
                            </Button>
                          )}
                          {record.workflowState === 'in_review' && (
                            <Button type="primary" onClick={() => act(record, 'approve')}>
                              批准
                            </Button>
                          )}
                          {record.workflowState === 'in_review' && (
                            <Button danger onClick={() => setRejecting(record)}>
                              拒绝
                            </Button>
                          )}
                          {record.workflowState === 'approved' && (
                            <Button type="primary" onClick={() => act(record, 'publish')}>
                              发布
                            </Button>
                          )}
                        </Space>
                      ),
                      title: '操作',
                    },
                  ]}
                  expandable={{
                    expandedRowRender: (record: any) => (
                      <Collapse
                        items={[
                          ...(record.type === 'skill'
                            ? [
                                {
                                  key: 'files',
                                  label: '审核包文件与正文',
                                  children: (
                                    <SkillReviewFiles
                                      identifier={record.identifier}
                                      versionId={record.versionId}
                                    />
                                  ),
                                },
                              ]
                            : []),
                          {
                            children: <JsonView value={record.metadata} />,
                            key: 'source',
                            label: '来源、许可与审核元数据',
                          },
                          {
                            children: <JsonView value={record.scanResult} />,
                            key: 'scan',
                            label: '安全扫描结果',
                          },
                          {
                            children: (
                              <Flex gap={16}>
                                <div style={{ flex: 1 }}>
                                  <Typography.Text strong>上一版本</Typography.Text>
                                  <JsonView value={record.previousConfig} />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <Typography.Text strong>当前版本</Typography.Text>
                                  <JsonView value={record.currentConfig} />
                                </div>
                              </Flex>
                            ),
                            key: 'diff',
                            label: '版本配置差异',
                          },
                        ]}
                      />
                    ),
                  }}
                />
              </Card>
            ),
            key: 'review',
            label: `投稿审核 (${reviews.data?.totalCount ?? 0})`,
          },
          {
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card title="新增白名单">
                  <Form layout="inline" onFinish={(value) => allowlistMutation.mutate(value)}>
                    <Form.Item label="Provider" name="provider" rules={[{ required: true }]}>
                      <Input placeholder="github" />
                    </Form.Item>
                    <Form.Item
                      label="目标 URL"
                      name="url"
                      rules={[{ required: true, type: 'url' }]}
                    >
                      <Input placeholder="https://github.example.com" />
                    </Form.Item>
                    <Form.Item name="allowPrivate" valuePropName="checked">
                      <Checkbox>允许解析到内网地址</Checkbox>
                    </Form.Item>
                    <Button htmlType="submit" loading={allowlistMutation.isPending} type="primary">
                      保存
                    </Button>
                  </Form>
                </Card>
                <Card>
                  <Table
                    dataSource={allowlist.data?.items ?? []}
                    loading={allowlist.isLoading}
                    rowKey="id"
                    columns={[
                      { dataIndex: 'provider', title: 'Provider' },
                      { dataIndex: 'protocol', title: '协议' },
                      { dataIndex: 'hostname', title: '域名' },
                      { dataIndex: 'port', title: '端口' },
                      {
                        dataIndex: 'allow_private',
                        render: (value) => (value ? '允许' : '禁止'),
                        title: '内网地址',
                      },
                      {
                        dataIndex: 'enabled',
                        render: (value) => (
                          <Tag color={value ? 'green' : 'red'}>{value ? '启用' : '停用'}</Tag>
                        ),
                        title: '状态',
                      },
                      {
                        render: (_, record: any) => (
                          <Button
                            danger={record.enabled}
                            loading={allowlistStatusMutation.isPending}
                            size="small"
                            onClick={() =>
                              allowlistStatusMutation.mutate({
                                enabled: !record.enabled,
                                id: record.id,
                              })
                            }
                          >
                            {record.enabled ? '停用' : '启用'}
                          </Button>
                        ),
                        title: '操作',
                      },
                    ]}
                  />
                </Card>
              </Space>
            ),
            key: 'allowlist',
            label: '连接器白名单',
          },
          {
            children: (
              <Card title="签名离线包">
                <Form
                  layout="vertical"
                  onFinish={(value) => {
                    try {
                      importMutation.mutate({
                        payload: JSON.parse(value.payload),
                        signature: value.signature,
                      });
                    } catch {
                      message.error('Payload 必须是有效 JSON');
                    }
                  }}
                >
                  <Form.Item label="Payload JSON" name="payload" rules={[{ required: true }]}>
                    <Input.TextArea rows={12} />
                  </Form.Item>
                  <Form.Item label="HMAC 签名" name="signature" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Button htmlType="submit" loading={importMutation.isPending} type="primary">
                    验签并导入
                  </Button>
                </Form>
              </Card>
            ),
            key: 'import',
            label: '离线导入',
          },
          {
            children: (
              <Card>
                <Table
                  dataSource={(audit.data?.items as any[]) ?? []}
                  loading={audit.isLoading}
                  rowKey="id"
                  columns={[
                    { dataIndex: 'created_at', title: '时间' },
                    { dataIndex: 'action', title: '动作' },
                    { dataIndex: 'target_type', title: '对象类型' },
                    { dataIndex: 'target_id', title: '对象' },
                    {
                      dataIndex: 'details',
                      render: (value) => <JsonView value={value} />,
                      title: '详情',
                    },
                  ]}
                />
              </Card>
            ),
            key: 'audit',
            label: 'Market 审计',
          },
        ]}
      />
      <Modal
        okButtonProps={{ danger: true, loading: reviewMutation.isPending }}
        open={!!rejecting}
        title="拒绝投稿"
        onCancel={() => setRejecting(undefined)}
        onOk={() =>
          rejecting &&
          reviewMutation.mutate({
            action: 'reject',
            versionId: rejecting!.versionId,
            expectedState: rejecting!.workflowState,
            identifier: rejecting.identifier,
            reason: rejectReason,
            type: rejecting.type,
          })
        }
      >
        <Input.TextArea
          placeholder="说明拒绝原因"
          rows={4}
          value={rejectReason}
          onChange={(event) => setRejectReason(event.target.value)}
        />
      </Modal>
    </>
  );
}
