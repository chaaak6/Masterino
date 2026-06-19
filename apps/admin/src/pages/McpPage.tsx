import { Card, Table, Typography } from 'antd';

import { trpc } from '@admin/lib/trpc';

export default function McpPage() {
  const mcpConnectors = trpc.admin.listMcpConnectors.useQuery({ page: 1, pageSize: 20 });

  return (
    <>
      <Typography.Title level={3}>MCP 连接器</Typography.Title>
      <Card>
        <Table
          columns={[
            { dataIndex: 'name', title: '名称' },
            { dataIndex: 'type', title: '类型' },
            { dataIndex: 'workspace', title: '工作区' },
            { dataIndex: 'toolCount', title: '工具数' },
            { dataIndex: 'policy', title: '策略' },
          ]}
          dataSource={mcpConnectors.data?.items ?? []}
          loading={mcpConnectors.isLoading}
          pagination={{ pageSize: 20, showSizeChanger: false, total: mcpConnectors.data?.total ?? 0 }}
          rowKey="id"
        />
      </Card>
    </>
  );
}
