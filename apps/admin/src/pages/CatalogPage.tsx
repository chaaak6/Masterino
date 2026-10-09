import { trpc } from '@admin/lib/trpc';
import { Alert, Button, Card, Flex, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import CatalogCreate from './CatalogCreate';

type CatalogResourceType = 'agent' | 'mcp' | 'skill';

const pageConfig: Record<CatalogResourceType, { description: string; title: string }> = {
  agent: {
    description: '管理客户端社区中的助手资源；客户端仅显示已发布且企业内可见的资源。',
    title: 'Agents 资源目录',
  },
  mcp: {
    description: '管理客户端社区中的 MCP 服务；连接策略与资源发布状态相互独立。',
    title: 'MCP 资源目录',
  },
  skill: {
    description: '管理客户端社区中的 Skills；策略配置不再与资源目录混为一谈。',
    title: 'Skills 资源目录',
  },
};

const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '已发布', value: 'published' },
  { label: '未发布', value: 'unpublished' },
  { label: '已下架', value: 'deprecated' },
];

const workflowOptions = [
  { label: '全部流程', value: '' },
  { label: '草稿', value: 'draft' },
  { label: '已提交', value: 'submitted' },
  { label: '扫描中', value: 'scanning' },
  { label: '审核中', value: 'in_review' },
  { label: '已批准', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
  { label: '已发布', value: 'published' },
  { label: '已下架', value: 'deprecated' },
];

const visibilityOptions = [
  { label: '全部范围', value: '' },
  { label: '企业内部', value: 'internal' },
  { label: '公开', value: 'public' },
  { label: '私有', value: 'private' },
];

const clientVisibilityOptions = [
  { label: '全部资源', value: 'all' },
  { label: '客户端可见', value: 'visible' },
  { label: '客户端不可见', value: 'hidden' },
];

const statusColor: Record<string, string> = {
  approved: 'blue',
  deprecated: 'default',
  in_review: 'gold',
  published: 'green',
  rejected: 'red',
  scanning: 'cyan',
  submitted: 'geekblue',
  unpublished: 'default',
};

type WorkflowState =
  | 'approved'
  | 'deprecated'
  | 'draft'
  | 'in_review'
  | 'published'
  | 'rejected'
  | 'scanning'
  | 'submitted';

export default function CatalogPage({ type }: { type: CatalogResourceType }) {
  const config = pageConfig[type];
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [workflowState, setWorkflowState] = useState('');
  const [visibility, setVisibility] = useState('');
  const [clientVisibility, setClientVisibility] = useState('all');
  const resources = trpc.admin.listCatalogResources.useQuery({
    clientVisible: clientVisibility === 'all' ? undefined : clientVisibility === 'visible',
    page,
    pageSize: 20,
    q: q || undefined,
    status: status || undefined,
    type,
    visibility: (visibility || undefined) as 'internal' | 'private' | 'public' | undefined,
    workflowState: (workflowState || undefined) as WorkflowState | undefined,
  });

  const resetPage = (callback: () => void) => {
    setPage(1);
    callback();
  };

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          {config.title}
        </Typography.Title>
        <Typography.Text type="secondary">{config.description}</Typography.Text>
      </div>
      {resources.error && (
        <Alert
          showIcon
          description={resources.error.message}
          message="资源目录加载失败"
          type="error"
          action={
            <Button size="small" onClick={() => resources.refetch()}>
              重试
            </Button>
          }
        />
      )}
      {creating && type !== 'agent' && (
        <CatalogCreate
          key={type}
          type={type}
          onCreated={() => void resources.refetch()}
          onCancel={() => setCreating(false)}
        />
      )}
      <Card>
        <Flex wrap gap={12} justify="space-between" style={{ marginBottom: 16 }}>
          <Flex wrap gap={8}>
            <Input.Search
              allowClear
              defaultValue={q}
              placeholder="搜索名称、标识符或描述"
              style={{ width: 280 }}
              onSearch={(value) => resetPage(() => setQ(value.trim()))}
            />
            <Select
              options={statusOptions}
              style={{ width: 128 }}
              value={status}
              onChange={(value) => resetPage(() => setStatus(value))}
            />
            <Select
              options={workflowOptions}
              style={{ width: 128 }}
              value={workflowState}
              onChange={(value) => resetPage(() => setWorkflowState(value))}
            />
            <Select
              options={visibilityOptions}
              style={{ width: 128 }}
              value={visibility}
              onChange={(value) => resetPage(() => setVisibility(value))}
            />
            <Select
              options={clientVisibilityOptions}
              style={{ width: 144 }}
              value={clientVisibility}
              onChange={(value) => resetPage(() => setClientVisibility(value))}
            />
          </Flex>
          {type !== 'agent' && (
            <Button type="primary" onClick={() => setCreating(true)}>
              {type === 'mcp' ? '创建 / 导入 MCP' : '创建 / 上传 Skill'}
            </Button>
          )}
          <Button loading={resources.isFetching} onClick={() => resources.refetch()}>
            刷新
          </Button>
        </Flex>
        <Table
          dataSource={resources.data?.items ?? []}
          loading={resources.isLoading}
          locale={{ emptyText: resources.error ? '加载失败，请重试' : '没有符合条件的资源' }}
          rowKey={(record) => `${record.type}:${record.identifier}`}
          scroll={{ x: 1120 }}
          columns={[
            {
              dataIndex: 'name',
              render: (value, record) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{value || record.identifier}</Typography.Text>
                  <Typography.Text copyable type="secondary">
                    {record.identifier}
                  </Typography.Text>
                </Space>
              ),
              title: '资源',
            },
            { dataIndex: 'version', title: '版本', width: 110 },
            { dataIndex: 'category', title: '分类', width: 120 },
            {
              dataIndex: 'status',
              render: (value) => <Tag color={statusColor[value]}>{value}</Tag>,
              title: '资源状态',
              width: 120,
            },
            {
              dataIndex: 'workflowState',
              render: (value) => <Tag color={statusColor[value]}>{value || '-'}</Tag>,
              title: '发布流程',
              width: 120,
            },
            {
              dataIndex: 'visibility',
              render: (value) =>
                ({ internal: '企业内部', private: '私有', public: '公开' })[value as string] ||
                value,
              title: '范围',
              width: 110,
            },
            {
              dataIndex: 'clientVisible',
              render: (value) => (
                <Tag color={value ? 'green' : 'default'}>
                  {value ? '客户端可见' : '客户端不可见'}
                </Tag>
              ),
              title: '客户端',
              width: 130,
            },
            { dataIndex: 'ownerName', title: '所有者', width: 140 },
          ]}
          pagination={{
            current: page,
            onChange: setPage,
            pageSize: 20,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 个资源`,
            total: resources.data?.totalCount ?? 0,
          }}
        />
      </Card>
    </Space>
  );
}
