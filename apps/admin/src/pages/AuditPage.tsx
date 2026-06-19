import { Card, Table, Typography } from 'antd';

import { trpc } from '@admin/lib/trpc';

export default function AuditPage() {
  const auditLogs = trpc.admin.listAuditLogs.useQuery({ page: 1, pageSize: 20 });

  return (
    <>
      <Typography.Title level={3}>审计日志</Typography.Title>
      <Card>
        <Table
          columns={[
            { dataIndex: 'time', title: '时间' },
            { dataIndex: 'actor', title: '操作者' },
            { dataIndex: 'action', title: '动作' },
            { dataIndex: 'resource', title: '资源' },
            { dataIndex: 'result', title: '结果' },
          ]}
          dataSource={auditLogs.data?.items ?? []}
          loading={auditLogs.isLoading}
          pagination={{ pageSize: 20, showSizeChanger: false, total: auditLogs.data?.total ?? 0 }}
          rowKey="id"
        />
      </Card>
    </>
  );
}
