import { Card, Table, Typography } from 'antd';

import { trpc } from '@admin/lib/trpc';

export default function SkillsPage() {
  const skillPolicies = trpc.admin.listSkillPolicies.useQuery({ page: 1, pageSize: 20 });

  return (
    <>
      <Typography.Title level={3}>Skills 策略</Typography.Title>
      <Card>
        <Table
          columns={[
            { dataIndex: 'name', title: '名称' },
            { dataIndex: 'source', title: '来源' },
            { dataIndex: 'scope', title: '范围' },
            { dataIndex: 'policy', title: '策略' },
          ]}
          dataSource={skillPolicies.data?.items ?? []}
          loading={skillPolicies.isLoading}
          pagination={{ pageSize: 20, showSizeChanger: false, total: skillPolicies.data?.total ?? 0 }}
          rowKey="id"
        />
      </Card>
    </>
  );
}
