import {
  Alert,
  Button,
  Card,
  Flex,
  Form,
  Input,
  message,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';

import { trpc } from '@admin/lib/trpc';

type KeyRow = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean | null;
  ownerName: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
};
const dateText = (value: Date | null) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
export default function AccessKeysPage() {
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [revealed, setRevealed] = useState<{ id: string; key: string }>();
  const [deleteTarget, setDeleteTarget] = useState<string>();
  const utils = trpc.useUtils();
  const list = trpc.admin.managedApiKeys.list.useQuery({ page, pageSize: 20, q: q || undefined });
  const refresh = () => utils.admin.managedApiKeys.list.invalidate();
  const onError = (error: { message: string }) => message.error(error.message);
  const create = trpc.admin.managedApiKeys.create.useMutation({
    onError,
    onSuccess: async () => {
      form.resetFields();
      setCreating(false);
      setPage(1);
      setQ('');
      setSearch('');
      await refresh();
      message.success('访问 Key 已创建，可在列表中查看并复制');
    },
  });
  const reveal = trpc.admin.managedApiKeys.reveal.useMutation({
    onError,
    onSuccess: (data, input) => setRevealed({ id: input.id, key: data.key }),
  });
  const toggle = trpc.admin.managedApiKeys.setEnabled.useMutation({
    onError,
    onSuccess: async (_, input) => {
      await refresh();
      message.success(input.enabled ? '访问 Key 已启用' : '访问 Key 已停用');
    },
  });
  const remove = trpc.admin.managedApiKeys.delete.useMutation({
    onError,
    onSuccess: async () => {
      setDeleteTarget(undefined);
      setRevealed(undefined);
      reveal.reset();
      await refresh();
      message.success('访问 Key 已删除');
    },
  });
  const busy = toggle.isPending || remove.isPending;
  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Flex align="center" justify="space-between" gap={16}>
        <div>
          <Typography.Title level={3} style={{ margin: '0 0 8px' }}>
            访问 Key
          </Typography.Title>
          <Typography.Text type="secondary">
            供 CLI 或 Agent 访问 Masterino，沿用归属账号的权限。仅管理从后台创建的 Key。
          </Typography.Text>
        </div>
        <Button type="primary" onClick={() => setCreating(true)} disabled={creating}>
          创建访问 Key
        </Button>
      </Flex>
      {creating && (
        <Card title="创建访问 Key">
          <Form
            form={form}
            layout="vertical"
            style={{ maxWidth: 640 }}
            onFinish={(values) =>
              create.mutate({
                name: values.name,
                description: values.description,
                expiresAt: values.expiresAt ? new Date(values.expiresAt) : null,
              })
            }
          >
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, whitespace: true, message: '请输入名称' }]}
            >
              <Input maxLength={256} placeholder="例如：社区资源导入" autoFocus />
            </Form.Item>
            <Form.Item name="description" label="用途">
              <Input.TextArea
                rows={2}
                maxLength={1000}
                placeholder="例如：Agent 批量上传 MCP 和 Skill，提交后台审核"
              />
            </Form.Item>
            <Form.Item
              name="expiresAt"
              label="有效期"
              extra="留空表示长期有效。Key 绑定当前登录账号，其他管理员可集中管理。"
            >
              <Input type="datetime-local" />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={create.isPending}>
                创建
              </Button>
              <Button
                disabled={create.isPending}
                onClick={() => {
                  setCreating(false);
                  form.resetFields();
                }}
              >
                取消
              </Button>
            </Space>
          </Form>
        </Card>
      )}
      {list.error && (
        <Alert
          type="error"
          showIcon
          message="访问 Key 加载失败"
          description={list.error.message}
          action={<Button onClick={() => list.refetch()}>重试</Button>}
        />
      )}
      <Card>
        <Flex justify="space-between" align="center" gap={16} style={{ marginBottom: 20 }}>
          <Input.Search
            style={{ maxWidth: 360 }}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
            placeholder="搜索名称或用途"
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
          />
          <Button loading={list.isFetching} onClick={() => list.refetch()}>
            刷新
          </Button>
        </Flex>
        <Table<KeyRow>
          rowKey="id"
          loading={list.isLoading}
          dataSource={list.data?.items || []}
          scroll={{ x: 1100 }}
          locale={{
            emptyText: q
              ? '没有符合搜索条件的访问 Key'
              : '暂无后台访问 Key，创建一个即可用于 CLI 或 Agent',
          }}
          pagination={{
            current: page,
            pageSize: 20,
            total: list.data?.total || 0,
            showSizeChanger: false,
            onChange: setPage,
            showTotal: (total) => `共 ${total} 个 Key`,
          }}
          columns={[
            {
              title: '名称与用途',
              key: 'name',
              width: 220,
              render: (_, item) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text strong>{item.name}</Typography.Text>
                  {item.description && (
                    <Typography.Text type="secondary">{item.description}</Typography.Text>
                  )}
                </Space>
              ),
            },
            { title: '归属管理员', dataIndex: 'ownerName', width: 120 },
            {
              title: '状态',
              key: 'status',
              width: 90,
              render: (_, item) =>
                !item.enabled ? (
                  <Tag>已停用</Tag>
                ) : item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now() ? (
                  <Tag color="orange">已过期</Tag>
                ) : (
                  <Tag color="green">已启用</Tag>
                ),
            },
            {
              title: 'Key',
              key: 'key',
              width: 220,
              render: (_, item) =>
                revealed?.id === item.id ? (
                  <Space direction="vertical" size={4}>
                    <Typography.Text
                      code
                      copyable={{ text: revealed.key }}
                      style={{ wordBreak: 'break-all' }}
                    >
                      {revealed.key}
                    </Typography.Text>
                    <Button
                      size="small"
                      type="link"
                      onClick={() => {
                        setRevealed(undefined);
                        reveal.reset();
                      }}
                    >
                      隐藏
                    </Button>
                  </Space>
                ) : (
                  <Space>
                    <Typography.Text type="secondary">••••••••</Typography.Text>
                    <Button
                      size="small"
                      type="link"
                      loading={reveal.isPending && reveal.variables?.id === item.id}
                      disabled={reveal.isPending}
                      onClick={() => reveal.mutate({ id: item.id })}
                    >
                      查看
                    </Button>
                  </Space>
                ),
            },
            {
              title: '时间',
              key: 'dates',
              width: 260,
              render: (_, item) => (
                <Space direction="vertical" size={4} style={{ fontSize: 12 }}>
                  <Typography.Text type="secondary">
                    创建：{dateText(item.createdAt)}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    有效期：{item.expiresAt ? dateText(item.expiresAt) : '长期有效'}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    最近使用：{dateText(item.lastUsedAt)}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 180,
              fixed: 'right',
              render: (_, item) =>
                deleteTarget === item.id ? (
                  <Space direction="vertical" size={4}>
                    <Typography.Text type="danger">删除后无法恢复</Typography.Text>
                    <Space>
                      <Button
                        size="small"
                        disabled={remove.isPending}
                        onClick={() => setDeleteTarget(undefined)}
                      >
                        取消
                      </Button>
                      <Button
                        size="small"
                        danger
                        type="primary"
                        loading={remove.isPending}
                        onClick={() => remove.mutate({ id: item.id })}
                      >
                        确认删除
                      </Button>
                    </Space>
                  </Space>
                ) : (
                  <Space>
                    <Button
                      size="small"
                      disabled={busy}
                      loading={toggle.isPending && toggle.variables?.id === item.id}
                      onClick={() => toggle.mutate({ id: item.id, enabled: !item.enabled })}
                    >
                      {item.enabled ? '停用' : '启用'}
                    </Button>
                    <Button
                      size="small"
                      danger
                      disabled={busy}
                      onClick={() => setDeleteTarget(item.id)}
                    >
                      删除
                    </Button>
                  </Space>
                ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
