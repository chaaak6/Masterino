import { Button, Card, Divider, Form, Input, InputNumber, message, Select, Space, Switch, Typography } from 'antd';
import { useEffect } from 'react';

import { trpc } from '@admin/lib/trpc';

type EnabledMode = 'web_qr' | 'workbench';
type DefaultRole = 'owner' | 'admin' | 'member' | 'viewer';
type DepartmentSyncMode = 'login' | 'manual' | 'scheduled';

type IdentityMapping = {
  departmentField: string;
  emailField: string;
  employeeNumberField: string;
  mobileField: string;
  nameField: string;
  positionField: string;
};

type DepartmentSync = {
  enabled: boolean;
  mode: DepartmentSyncMode;
};

type AihubProvisioning = {
  autoCreateUser: boolean;
  enabled: boolean;
  initialQuota: number;
  lookupField: string;
  managedTokenName: string;
  managedTokenQuota: number;
  managedTokenUnlimitedQuota: boolean;
  userGroup?: string;
};

const ssoModeOptions: { label: string; value: EnabledMode }[] = [
  { label: '网页扫码登录', value: 'web_qr' },
  { label: '企业微信工作台', value: 'workbench' },
];

const roleOptions: { label: string; value: DefaultRole }[] = [
  { label: '所有者', value: 'owner' },
  { label: '管理员', value: 'admin' },
  { label: '成员', value: 'member' },
  { label: '访客', value: 'viewer' },
];

const departmentSyncModeOptions: { label: string; value: DepartmentSyncMode }[] = [
  { label: '登录时同步', value: 'login' },
  { label: '手动同步', value: 'manual' },
  { label: '定时同步', value: 'scheduled' },
];

const aihubLookupFieldOptions = [
  { label: 'Employee number', value: 'employeeNumber' },
  { label: 'Email', value: 'email' },
  { label: 'Name', value: 'name' },
];

const emptyConfig = {
  agentId: '',
  aihubProvisioning: {
    autoCreateUser: false,
    enabled: false,
    initialQuota: 0,
    lookupField: 'employeeNumber',
    managedTokenName: 'masterlion-managed',
    managedTokenQuota: 0,
    managedTokenUnlimitedQuota: false,
    userGroup: undefined as string | undefined,
  } as AihubProvisioning,
  autoProvision: false,
  corpId: '',
  defaultRole: 'member' as DefaultRole,
  defaultWorkspaceId: undefined as string | undefined,
  departmentSync: {
    enabled: false,
    mode: 'login' as DepartmentSyncMode,
  } as DepartmentSync,
  enabled: false,
  enabledModes: [] as EnabledMode[],
  identityMapping: {
    departmentField: 'department',
    emailField: 'email',
    employeeNumberField: 'userid',
    mobileField: 'mobile',
    nameField: 'name',
    positionField: 'position',
  } as IdentityMapping,
  redirectUri: '',
  trustedDomains: [] as string[],
};

type SsoFormValues = typeof emptyConfig & {
  corpSecret?: string;
};

export default function SsoPage() {
  const [form] = Form.useForm<SsoFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const ssoConfig = trpc.admin.getSsoConfig.useQuery();
  const updateSsoConfig = trpc.admin.updateSsoConfig.useMutation({
    onSuccess: async () => {
      form.setFieldValue('corpSecret', '');
      messageApi.success('SSO 配置已保存');
      await ssoConfig.refetch();
    },
  });

  useEffect(() => {
    if (!ssoConfig.data) return;

    form.setFieldsValue({
      ...emptyConfig,
      ...ssoConfig.data.config,
      corpSecret: '',
    });
  }, [form, ssoConfig.data]);

  const handleFinish = (values: SsoFormValues) => {
    const corpSecret = values.corpSecret?.trim();
    const defaultWorkspaceId = values.defaultWorkspaceId?.trim();
    const aihubProvisioning = values.aihubProvisioning ?? emptyConfig.aihubProvisioning;
    const userGroup = aihubProvisioning.userGroup?.trim();

    updateSsoConfig.mutate({
      config: {
        agentId: values.agentId,
        aihubProvisioning: {
          ...aihubProvisioning,
          initialQuota: aihubProvisioning.initialQuota ?? 0,
          managedTokenQuota: aihubProvisioning.managedTokenQuota ?? 0,
          userGroup: userGroup || undefined,
        },
        autoProvision: values.autoProvision,
        corpId: values.corpId,
        defaultRole: values.defaultRole,
        defaultWorkspaceId: defaultWorkspaceId || undefined,
        departmentSync: values.departmentSync ?? emptyConfig.departmentSync,
        enabled: values.enabled,
        enabledModes: values.enabledModes,
        identityMapping: values.identityMapping ?? emptyConfig.identityMapping,
        redirectUri: values.redirectUri,
        trustedDomains: values.trustedDomains,
      },
      corpSecret: corpSecret || undefined,
      provider: 'wecom',
    });
  };

  return (
    <>
      {contextHolder}
      <Typography.Title level={3}>SSO 配置</Typography.Title>
      <Card loading={ssoConfig.isLoading}>
        <Form
          disabled={updateSsoConfig.isPending}
          form={form}
          initialValues={emptyConfig}
          layout="vertical"
          onFinish={handleFinish}
        >
          <Form.Item label="Corp ID" name="corpId">
            <Input placeholder="企业微信 Corp ID" />
          </Form.Item>
          <Form.Item label="Agent ID" name="agentId">
            <Input placeholder="企业微信 Agent ID" />
          </Form.Item>
          <Form.Item label="Corp Secret" name="corpSecret">
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Input.Password autoComplete="new-password" placeholder="留空则保持当前密钥不变" />
              <Typography.Text type={ssoConfig.data?.corpSecretConfigured ? 'success' : 'secondary'}>
                {ssoConfig.data?.corpSecretConfigured ? '已配置' : '未配置'}
              </Typography.Text>
            </Space>
          </Form.Item>
          <Form.Item label="回调地址" name="redirectUri" rules={[{ type: 'url' }]}>
            <Input placeholder="https://example.com/api/auth/oauth2/callback/wecom" />
          </Form.Item>
          <Form.Item label="可信域名" name="trustedDomains">
            <Select mode="tags" placeholder="输入域名后回车" tokenSeparators={[',', ' ']} />
          </Form.Item>
          <Form.Item label="启用模式" name="enabledModes">
            <Select mode="multiple" options={ssoModeOptions} placeholder="选择启用模式" />
          </Form.Item>
          <Form.Item label="默认工作区" name="defaultWorkspaceId">
            <Input placeholder="默认工作区 ID" />
          </Form.Item>
          <Form.Item label="默认角色" name="defaultRole">
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item label="自动创建用户" name="autoProvision" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Divider orientation="left">身份字段映射</Divider>
          <Form.Item label="员工号字段" name={['identityMapping', 'employeeNumberField']}>
            <Input placeholder="userid" />
          </Form.Item>
          <Form.Item label="部门字段" name={['identityMapping', 'departmentField']}>
            <Input placeholder="department" />
          </Form.Item>
          <Form.Item label="姓名字段" name={['identityMapping', 'nameField']}>
            <Input placeholder="name" />
          </Form.Item>
          <Form.Item label="邮箱字段" name={['identityMapping', 'emailField']}>
            <Input placeholder="email" />
          </Form.Item>
          <Form.Item label="手机号字段" name={['identityMapping', 'mobileField']}>
            <Input placeholder="mobile" />
          </Form.Item>
          <Form.Item label="职位字段" name={['identityMapping', 'positionField']}>
            <Input placeholder="position" />
          </Form.Item>
          <Divider orientation="left">部门同步</Divider>
          <Form.Item label="启用部门同步" name={['departmentSync', 'enabled']} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="同步模式" name={['departmentSync', 'mode']}>
            <Select options={departmentSyncModeOptions} />
          </Form.Item>
          <Divider orientation="left">AIHub 自动开通</Divider>
          <Form.Item label="启用 AIHub 开通" name={['aihubProvisioning', 'enabled']} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="查找字段" name={['aihubProvisioning', 'lookupField']}>
            <Select options={aihubLookupFieldOptions} />
          </Form.Item>
          <Form.Item label="自动创建 AIHub 用户" name={['aihubProvisioning', 'autoCreateUser']} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="初始额度" name={['aihubProvisioning', 'initialQuota']}>
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="托管令牌名称" name={['aihubProvisioning', 'managedTokenName']}>
            <Input placeholder="masterlion-managed" />
          </Form.Item>
          <Form.Item
            label="托管令牌无限额度"
            name={['aihubProvisioning', 'managedTokenUnlimitedQuota']}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item label="托管令牌额度" name={['aihubProvisioning', 'managedTokenQuota']}>
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="用户组" name={['aihubProvisioning', 'userGroup']}>
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item label="启用 SSO" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item>
            <Button htmlType="submit" loading={updateSsoConfig.isPending} type="primary">
              保存配置
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </>
  );
}
