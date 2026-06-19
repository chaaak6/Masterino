import { ShieldCheck } from 'lucide-react';
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import { useMemo, useState } from 'react';

import { trpc } from '@admin/lib/trpc';

type PrincipalType = 'department' | 'role' | 'user' | 'workspace';
type ResourcePermission = 'manage' | 'read' | 'write';

interface KnowledgeBaseRow {
  id: string;
  name: string;
  resources: number;
  updatedAt: string;
  visibility: string;
  workspace: string;
  workspaceId?: null | string;
}

interface ResourceGrantRow {
  id: string;
  permission: ResourcePermission;
  principalId: string;
  principalType: PrincipalType;
  updatedAt: string;
}

interface GrantFormValues {
  permission: ResourcePermission;
  principalId: string;
  principalType: PrincipalType;
}

const principalTypeLabels: Record<PrincipalType, string> = {
  department: '部门',
  role: '角色',
  user: '用户',
  workspace: '工作区',
};

const permissionLabels: Record<ResourcePermission, string> = {
  manage: '管理',
  read: '读取',
  write: '编辑',
};

const permissionColors: Record<ResourcePermission, string> = {
  manage: 'red',
  read: 'blue',
  write: 'green',
};

const formatTime = (value: string) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('zh-CN', { hour12: false });
};

export default function KnowledgePage() {
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState<KnowledgeBaseRow | null>(null);
  const [form] = Form.useForm<GrantFormValues>();
  const utils = trpc.useUtils();

  const knowledgeBases = trpc.admin.listKnowledgeBases.useQuery({ page: 1, pageSize: 20 });
  const grants = trpc.admin.listResourceGrants.useQuery(
    {
      resourceId: selectedKnowledgeBase?.id ?? '',
      resourceType: 'knowledge_base',
    },
    { enabled: Boolean(selectedKnowledgeBase) },
  );
  const grantPermission = trpc.admin.grantResourcePermission.useMutation({
    async onSuccess() {
      message.success('权限已保存');
      form.resetFields();

      if (selectedKnowledgeBase) {
        await utils.admin.listResourceGrants.invalidate({
          resourceId: selectedKnowledgeBase.id,
          resourceType: 'knowledge_base',
        });
      }
    },
  });

  const knowledgeColumns = useMemo<TableProps<KnowledgeBaseRow>['columns']>(
    () => [
      {
        dataIndex: 'name',
        title: '知识库',
      },
      {
        dataIndex: 'workspace',
        title: '归属空间',
      },
      {
        dataIndex: 'visibility',
        render: (value: string) => <Tag>{value}</Tag>,
        title: '可见性',
        width: 120,
      },
      {
        dataIndex: 'resources',
        title: '资源数',
        width: 120,
      },
      {
        dataIndex: 'updatedAt',
        render: formatTime,
        title: '更新时间',
        width: 220,
      },
      {
        key: 'actions',
        render: (_value, record) => (
          <Button icon={<ShieldCheck size={16} />} onClick={() => setSelectedKnowledgeBase(record)}>
            权限
          </Button>
        ),
        title: '操作',
        width: 120,
      },
    ],
    [],
  );

  const grantColumns = useMemo<TableProps<ResourceGrantRow>['columns']>(
    () => [
      {
        dataIndex: 'principalType',
        render: (value: PrincipalType) => principalTypeLabels[value] ?? value,
        title: '对象类型',
        width: 110,
      },
      {
        dataIndex: 'principalId',
        ellipsis: true,
        title: '对象 ID',
      },
      {
        dataIndex: 'permission',
        render: (value: ResourcePermission) => (
          <Tag color={permissionColors[value]}>{permissionLabels[value] ?? value}</Tag>
        ),
        title: '权限',
        width: 100,
      },
      {
        dataIndex: 'updatedAt',
        render: formatTime,
        title: '更新时间',
        width: 180,
      },
    ],
    [],
  );

  const submitGrant = (values: GrantFormValues) => {
    if (!selectedKnowledgeBase) return;

    grantPermission.mutate({
      ...values,
      resourceId: selectedKnowledgeBase.id,
      resourceType: 'knowledge_base',
    });
  };

  return (
    <>
      <Typography.Title level={3}>知识库管理</Typography.Title>
      <Card>
        <Table<KnowledgeBaseRow>
          columns={knowledgeColumns}
          dataSource={(knowledgeBases.data?.items ?? []) as KnowledgeBaseRow[]}
          loading={knowledgeBases.isLoading}
          pagination={{
            pageSize: 20,
            showSizeChanger: false,
            total: knowledgeBases.data?.total ?? 0,
          }}
          rowKey="id"
        />
      </Card>

      <Drawer
        destroyOnHidden
        open={Boolean(selectedKnowledgeBase)}
        title={selectedKnowledgeBase ? `${selectedKnowledgeBase.name} 权限` : '知识库权限'}
        width={640}
        onClose={() => setSelectedKnowledgeBase(null)}
      >
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Form<GrantFormValues>
            form={form}
            initialValues={{ permission: 'read', principalType: 'user' }}
            layout="vertical"
            onFinish={submitGrant}
          >
            <Form.Item label="对象类型" name="principalType" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: '用户', value: 'user' },
                  { label: '角色', value: 'role' },
                  { label: '工作区', value: 'workspace' },
                  { label: '部门', value: 'department' },
                ]}
              />
            </Form.Item>
            <Form.Item label="对象 ID" name="principalId" rules={[{ required: true }]}>
              <Input placeholder="输入用户、角色、工作区或部门 ID" />
            </Form.Item>
            <Form.Item label="权限" name="permission" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: '读取', value: 'read' },
                  { label: '编辑', value: 'write' },
                  { label: '管理', value: 'manage' },
                ]}
              />
            </Form.Item>
            <Button htmlType="submit" loading={grantPermission.isPending} type="primary">
              保存权限
            </Button>
          </Form>

          <Table<ResourceGrantRow>
            columns={grantColumns}
            dataSource={(grants.data?.items ?? []) as ResourceGrantRow[]}
            loading={grants.isLoading}
            pagination={false}
            rowKey="id"
            size="small"
          />
        </Space>
      </Drawer>
    </>
  );
}
