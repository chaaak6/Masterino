import { Card, Input, Table, Typography } from 'antd';

import { trpc } from '@admin/lib/trpc';

export default function UsersPage() {
  const users = trpc.admin.listUsers.useQuery({ page: 1, pageSize: 20 });

  return (
    <>
      <Typography.Title level={3}>用户管理</Typography.Title>
      <Card>
        <Input.Search
          allowClear
          placeholder="搜索姓名、邮箱或用户 ID"
          style={{ marginBottom: 16, maxWidth: 360 }}
        />
        <Table
          columns={[
            { dataIndex: 'name', title: '用户' },
            { dataIndex: 'email', title: '邮箱' },
            { dataIndex: 'role', title: '角色' },
            { dataIndex: 'status', title: '状态' },
          ]}
          dataSource={users.data?.items ?? []}
          loading={users.isLoading}
          pagination={{ pageSize: 20, showSizeChanger: false, total: users.data?.total ?? 0 }}
          rowKey="id"
        />
      </Card>
    </>
  );
}
