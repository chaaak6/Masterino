import { Card, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';

import { trpc } from '@admin/lib/trpc';

interface RoleItem {
  description: string;
  id: string;
  name: string;
  permissions: string[];
}

const permissionCodes = ['users:*', 'workspace:*', 'knowledge:*', 'mcp:*', 'system:*'];

const columns: TableProps<RoleItem>['columns'] = [
  { dataIndex: 'name', title: '角色名' },
  { dataIndex: 'description', title: '说明' },
  ...permissionCodes.map((permission) => ({
    key: permission,
    render: (_value: unknown, record: RoleItem) =>
      record.permissions.includes(permission) ? <Tag color="green">允许</Tag> : <Tag>未授权</Tag>,
    title: permission,
  })),
];

export default function RolesPage() {
  const roles = trpc.admin.listRoles.useQuery();

  return (
    <>
      <Typography.Title level={3}>角色权限</Typography.Title>
      <Card>
        <Table<RoleItem>
          columns={columns}
          dataSource={roles.data?.items ?? []}
          loading={roles.isLoading}
          pagination={false}
          rowKey="id"
        />
      </Card>
    </>
  );
}
