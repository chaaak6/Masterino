import { Card, Table, Typography } from 'antd';

import { trpc } from '@admin/lib/trpc';

export default function WorkspacesPage() {
  const workspaces = trpc.admin.listWorkspaces.useQuery({ page: 1, pageSize: 20 });

  return (
    <>
      <Typography.Title level={3}>工作区管理</Typography.Title>
      <Card>
        <Table
          columns={[
            { dataIndex: 'name', title: '工作区' },
            { dataIndex: 'memberCount', title: '成员数' },
            { dataIndex: 'resourceCount', title: '资源数' },
            { dataIndex: 'createdAt', title: '创建时间' },
          ]}
          dataSource={workspaces.data?.items ?? []}
          loading={workspaces.isLoading}
          pagination={{ pageSize: 20, showSizeChanger: false, total: workspaces.data?.total ?? 0 }}
          rowKey="id"
        />
      </Card>
    </>
  );
}
