import { Card, Descriptions, Skeleton, Space, Typography } from 'antd';

import { trpc } from '@admin/lib/trpc';

const emptySystemConfig = {
  knowledge: {
    defaultVisibility: '',
    enabled: false,
    maxResourcesPerBase: 0,
  },
  skillMcp: {
    defaultMcpPolicy: '',
    defaultSkillPolicy: '',
    mcpEnabled: false,
    skillsEnabled: false,
  },
  upload: {
    allowedTypes: [] as string[],
    maxFileSizeMb: 0,
    retentionDays: 0,
  },
};

const formatBoolean = (value: boolean) => (value ? '启用' : '停用');

export default function SystemConfigPage() {
  const systemConfig = trpc.admin.getSystemConfig.useQuery();

  if (systemConfig.isLoading) {
    return <Skeleton active />;
  }

  const config = systemConfig.data ?? emptySystemConfig;

  return (
    <>
      <Typography.Title level={3}>系统配置</Typography.Title>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="上传配置">
          <Descriptions
            bordered
            column={1}
            items={[
              { children: `${config.upload.maxFileSizeMb} MB`, key: 'maxFileSizeMb', label: '最大文件大小' },
              {
                children: config.upload.allowedTypes.length > 0 ? config.upload.allowedTypes.join(', ') : '未限制',
                key: 'allowedTypes',
                label: '允许类型',
              },
              { children: `${config.upload.retentionDays} 天`, key: 'retentionDays', label: '保留周期' },
            ]}
          />
        </Card>
        <Card title="知识库配置">
          <Descriptions
            bordered
            column={1}
            items={[
              { children: formatBoolean(config.knowledge.enabled), key: 'enabled', label: '知识库能力' },
              { children: config.knowledge.defaultVisibility, key: 'visibility', label: '默认可见性' },
              {
                children: config.knowledge.maxResourcesPerBase,
                key: 'maxResourcesPerBase',
                label: '单库资源上限',
              },
            ]}
          />
        </Card>
        <Card title="Skill / MCP 配置">
          <Descriptions
            bordered
            column={1}
            items={[
              { children: formatBoolean(config.skillMcp.skillsEnabled), key: 'skillsEnabled', label: 'Skills' },
              { children: config.skillMcp.defaultSkillPolicy, key: 'defaultSkillPolicy', label: '默认 Skill 策略' },
              { children: formatBoolean(config.skillMcp.mcpEnabled), key: 'mcpEnabled', label: 'MCP' },
              { children: config.skillMcp.defaultMcpPolicy, key: 'defaultMcpPolicy', label: '默认 MCP 策略' },
            ]}
          />
        </Card>
      </Space>
    </>
  );
}
