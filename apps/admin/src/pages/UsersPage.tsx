import UserAvailabilityDrawer from '@admin/features/UserAvailability/UserAvailabilityDrawer';
import { trpc } from '@admin/lib/trpc';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  message,
  Popconfirm,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';

const formatNumber = (value?: null | number) => Number(value ?? 0).toLocaleString('zh-CN');

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [selectedAvailabilityUserId, setSelectedAvailabilityUserId] = useState<string>();
  const utils = trpc.useUtils();
  const users = trpc.admin.listUsers.useQuery({ page, pageSize: 20, q: query || undefined });
  const availability = trpc.admin.listUserAvailability.useQuery(
    { page, pageSize: 20, q: query || undefined },
    { retry: false },
  );
  const diagnostics = trpc.admin.getUserUsageDiagnostics.useQuery(
    { userId: selectedUserId! },
    { enabled: Boolean(selectedUserId) },
  );
  const pause = trpc.admin.pauseUserAutomations.useMutation({
    onError: (error) => message.error(error.message),
    onSuccess: async (result) => {
      const failed = result.results.filter((item) => item.status === 'failed').length;
      message.success(
        failed ? `暂停完成，${failed} 个任务失败` : `已暂停 ${result.results.length} 个自动任务`,
      );
      await diagnostics.refetch();
    },
  });
  const resume = trpc.admin.resumeTaskAutomation.useMutation({
    onError: (error) => message.error(error.message),
    onSuccess: async ({ operationId }) => {
      message.success(`任务已恢复，新 Operation：${operationId}`);
      await Promise.all([diagnostics.refetch(), utils.admin.listUsers.invalidate()]);
    },
  });
  const detail = diagnostics.data;
  const availabilityByUserId = new Map(
    (availability.data?.items ?? []).map((item) => [item.id, item]),
  );

  return (
    <>
      <Typography.Title level={3}>用户可用性</Typography.Title>
      <Card>
        <Input.Search
          allowClear
          placeholder="搜索工号、姓名、邮箱或 Masterino userId"
          style={{ marginBottom: 16, maxWidth: 480 }}
          onSearch={(value) => {
            setPage(1);
            setQuery(value.trim());
          }}
        />
        {availability.error && !/forbidden|permission|无权限/i.test(availability.error.message) && (
          <Alert
            showIcon
            message="Aihub 可用性暂时无法查询；基础用户列表仍可使用"
            style={{ marginBottom: 16 }}
            type="warning"
          />
        )}
        <Table
          dataSource={users.data?.items ?? []}
          loading={users.isLoading}
          rowKey="id"
          columns={[
            { dataIndex: 'name', title: '用户' },
            { dataIndex: 'employeeNumber', title: '工号' },
            { dataIndex: 'status', title: 'Masterino' },
            {
              render: (_: unknown, record: { id: string }) =>
                availabilityByUserId.get(record.id)?.bindingStatus ?? '-',
              title: 'Readiness',
            },
            {
              render: (_: unknown, record: { id: string }) => {
                const item = availabilityByUserId.get(record.id);
                return item?.managedTokenId
                  ? `#${item.managedTokenId} · ${item.tokenHealth}`
                  : '未绑定';
              },
              title: '绑定 Token',
            },
            {
              render: (_: unknown, record: { id: string }) =>
                availabilityByUserId.get(record.id)?.modelCount ?? '-',
              title: '聊天模型',
            },
            {
              render: (_: unknown, record: { id: string }) => {
                const health = availabilityByUserId.get(record.id)?.health;
                return health ? (
                  <Tag
                    color={
                      health === 'active' ? 'success' : health === 'unknown' ? 'warning' : 'error'
                    }
                  >
                    {
                      {
                        active: '可用',
                        blocked: '不可用',
                        uninitialized: '未初始化',
                        unknown: '待确认',
                      }[health]
                    }
                  </Tag>
                ) : (
                  '-'
                );
              },
              title: '整体状态',
            },
            {
              render: (_: unknown, record: { id: string }) => (
                <Space size="small">
                  <Button type="link" onClick={() => setSelectedAvailabilityUserId(record.id)}>
                    可用性
                  </Button>
                  <Button type="link" onClick={() => setSelectedUserId(record.id)}>
                    更多诊断
                  </Button>
                </Space>
              ),
              title: '操作',
            },
          ]}
          pagination={{
            current: page,
            onChange: setPage,
            pageSize: 20,
            showSizeChanger: false,
            total: users.data?.total ?? 0,
          }}
        />
      </Card>

      <UserAvailabilityDrawer
        userId={selectedAvailabilityUserId}
        onClose={() => setSelectedAvailabilityUserId(undefined)}
        onUpdated={() => Promise.all([availability.refetch(), utils.admin.listUsers.invalidate()])}
      />

      <Drawer
        destroyOnHidden
        loading={diagnostics.isLoading}
        open={Boolean(selectedUserId)}
        size="large"
        title="用户后台 Token 用量诊断"
        onClose={() => setSelectedUserId(undefined)}
      >
        {diagnostics.error && <Alert showIcon message={diagnostics.error.message} type="error" />}
        {detail && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Descriptions bordered column={1} size="small" title="身份映射">
              <Descriptions.Item label="工号">
                {detail.identity.employeeNumber || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Masterino userId">
                <Typography.Text copyable>{detail.identity.masterinoUserId}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Aihub userId">
                {detail.identity.aihub.newApiUserId ?? '未绑定'}
              </Descriptions.Item>
              <Descriptions.Item label="Langfuse userId">
                <Typography.Text copyable>{detail.identity.langfuseUserId}</Typography.Text>
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title="近 24 小时 Aihub 用量">
              {detail.aihubUsageError ? (
                <Alert showIcon message={detail.aihubUsageError} type="warning" />
              ) : (
                <Space wrap size="large">
                  <Statistic
                    title="Token"
                    value={formatNumber(detail.aihubUsage?.totalTokens as number)}
                  />
                  <Statistic
                    title="请求"
                    value={formatNumber(detail.aihubUsage?.requestCount as number)}
                  />
                  <Statistic
                    title="输入 Token"
                    value={formatNumber(detail.aihubUsage?.totalPromptTokens as number)}
                  />
                  <Statistic
                    title="输出 Token"
                    value={formatNumber(detail.aihubUsage?.totalCompletionTokens as number)}
                  />
                </Space>
              )}
            </Card>

            <Descriptions bordered column={1} size="small" title="服务端限制">
              <Descriptions.Item label="后台任务预算">
                {detail.executionBudget.maxSteps} 步 / {detail.executionBudget.maxDurationMs / 1000}{' '}
                秒 / {formatNumber(detail.executionBudget.maxTotalTokens)} Token
              </Descriptions.Item>
              <Descriptions.Item label="Embedding 模型">
                {detail.embedding.provider}/{detail.embedding.model}
              </Descriptions.Item>
              <Descriptions.Item label="配置上限">
                {formatNumber(detail.embedding.configuredLimit)} Token
              </Descriptions.Item>
              <Descriptions.Item label="模型窗口">
                {detail.embedding.modelContextWindow
                  ? `${formatNumber(detail.embedding.modelContextWindow)} Token`
                  : '未登记（按 7,500 Token 回退）'}
              </Descriptions.Item>
              <Descriptions.Item label="最终有效上限">
                {formatNumber(detail.embedding.effectiveLimit)} Token
              </Descriptions.Item>
            </Descriptions>

            <Card
              size="small"
              title="自动任务"
              extra={
                <Popconfirm
                  description="会中断运行中的 Operation，并暂停该用户全部自动任务。"
                  title="确认暂停全部自动任务？"
                  onConfirm={() =>
                    pause.mutate({
                      reason: 'Paused from admin usage diagnostics',
                      userId: detail.identity.masterinoUserId,
                    })
                  }
                >
                  <Button danger loading={pause.isPending}>
                    一键暂停自动任务
                  </Button>
                </Popconfirm>
              }
            >
              <Table
                dataSource={detail.tasks}
                pagination={false}
                rowKey="id"
                size="small"
                columns={[
                  { dataIndex: 'identifier', title: '任务' },
                  { dataIndex: 'name', title: '名称' },
                  { dataIndex: 'automationMode', title: '模式' },
                  {
                    dataIndex: 'status',
                    render: (status: string) => <Tag>{status}</Tag>,
                    title: '状态',
                  },
                  {
                    render: (_: unknown, task: { id: string; status: string }) => (
                      <Button
                        disabled={task.status !== 'paused'}
                        loading={resume.isPending && resume.variables?.taskId === task.id}
                        size="small"
                        onClick={() =>
                          resume.mutate({
                            taskId: task.id,
                            userId: detail.identity.masterinoUserId,
                          })
                        }
                      >
                        恢复并运行
                      </Button>
                    ),
                    title: '操作',
                  },
                ]}
              />
            </Card>

            <Card size="small" title="最近后台 Operation（Trace ID = Operation ID）">
              <Table
                dataSource={detail.operations}
                pagination={{ pageSize: 10 }}
                rowKey="id"
                scroll={{ x: 1100 }}
                size="small"
                columns={[
                  {
                    dataIndex: 'id',
                    render: (value: string) => <Typography.Text copyable>{value}</Typography.Text>,
                    title: 'Operation / Trace',
                  },
                  { dataIndex: 'trigger', title: '触发源' },
                  { dataIndex: 'model', title: '模型' },
                  { dataIndex: 'status', title: '状态' },
                  { dataIndex: 'completionReason', title: '终止原因' },
                  {
                    dataIndex: ['tokens', 'total'],
                    render: (value: number) => formatNumber(value),
                    title: 'Token',
                  },
                  {
                    dataIndex: 'budgetSnapshot',
                    render: (budget?: {
                      maxDurationMs: number;
                      maxSteps: number;
                      maxTotalTokens: number;
                    }) =>
                      budget
                        ? `${budget.maxSteps} 步 / ${budget.maxDurationMs / 1000} 秒 / ${formatNumber(
                            budget.maxTotalTokens,
                          )}`
                        : '-',
                    title: '预算快照',
                  },
                ]}
              />
            </Card>

            <Card size="small" title="暂停与恢复审计记录">
              <Table
                dataSource={detail.auditLogs}
                pagination={{ pageSize: 10 }}
                rowKey="id"
                size="small"
                columns={[
                  { dataIndex: 'time', title: '时间' },
                  { dataIndex: 'action', title: '动作' },
                  { dataIndex: 'actor', title: '操作人' },
                  { dataIndex: 'resource', title: '对象' },
                  { dataIndex: 'result', title: '结果' },
                ]}
              />
            </Card>
          </Space>
        )}
      </Drawer>
    </>
  );
}
