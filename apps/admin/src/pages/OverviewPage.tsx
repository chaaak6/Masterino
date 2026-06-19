import { Card, Col, Row, Skeleton, Statistic, Typography } from 'antd';

import { trpc } from '@admin/lib/trpc';

const emptyOverview = {
  knowledgeBases: 0,
  mcpConnectors: 0,
  users: 0,
  workspaces: 0,
};

export default function OverviewPage() {
  const overview = trpc.admin.overview.useQuery();

  if (overview.isLoading) {
    return <Skeleton active />;
  }

  const data = overview.data ?? emptyOverview;
  const stats = [
    { title: '\u7528\u6237', value: data.users },
    { title: '\u5de5\u4f5c\u533a', value: data.workspaces },
    { title: '\u77e5\u8bc6\u5e93', value: data.knowledgeBases },
    { title: 'MCP \u8fde\u63a5', value: data.mcpConnectors },
  ];

  return (
    <>
      <Typography.Title level={3}>{'\u603b\u89c8'}</Typography.Title>
      <Row gutter={[16, 16]}>
        {stats.map((stat) => (
          <Col key={stat.title} lg={6} md={12} xs={24}>
            <Card>
              <Statistic title={stat.title} value={stat.value} />
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}
