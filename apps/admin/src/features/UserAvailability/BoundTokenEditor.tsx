import type { LambdaRouter } from '@masterlion/server/routers/lambda';
import type { inferRouterOutputs } from '@trpc/server';
import { Form, Input, InputNumber, message, Modal, Select, Switch } from 'antd';
import { useEffect } from 'react';

type Availability = inferRouterOutputs<LambdaRouter>['admin']['getUserAvailability'];
type Token = NonNullable<NonNullable<Availability['token']['inspection']>['token']>;

interface BoundTokenEditorProps {
  loading: boolean;
  onClose: () => void;
  onSave: (
    patch: Partial<{
      allow_ips: string;
      expired_time: number;
      group: string;
      model_limits: string;
      model_limits_enabled: boolean;
      remain_quota: number;
      status: 1 | 2;
      unlimited_quota: boolean;
    }>,
  ) => Promise<void>;
  open: boolean;
  quotaPolicy: Availability['quotaPolicy'];
  token: Token;
}

interface TokenFormValues {
  allow_ips: string;
  enabled: boolean;
  expiration: 'custom' | 'never';
  expired_at: string;
  group: string;
  model_limits: string;
  model_limits_enabled: boolean;
  remain_amount: number;
  unlimited_quota: boolean;
}

const toMoney = (quota: number, policy: Availability['quotaPolicy']) =>
  Math.round(
    (quota / policy.quotaPerUnit) *
      (policy.quotaDisplayType === 'CNY' ? policy.usdExchangeRate : 1) *
      100,
  ) / 100;

const toQuota = (amount: number, policy: Availability['quotaPolicy']) =>
  Math.round(
    (amount / (policy.quotaDisplayType === 'CNY' ? policy.usdExchangeRate : 1)) *
      policy.quotaPerUnit,
  );

const formatLocalDateTime = (seconds: number) => {
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function BoundTokenEditor({
  loading,
  onClose,
  onSave,
  open,
  quotaPolicy,
  token,
}: BoundTokenEditorProps) {
  const [form] = Form.useForm<TokenFormValues>();
  const unlimited = Form.useWatch('unlimited_quota', form);
  const modelLimitsEnabled = Form.useWatch('model_limits_enabled', form);
  const expiration = Form.useWatch('expiration', form);

  useEffect(() => {
    if (!open || !token) return;
    form.setFieldsValue({
      allow_ips: token.allow_ips ?? '',
      enabled: token.status === 1,
      expired_at:
        token.expired_time && token.expired_time > 0 ? formatLocalDateTime(token.expired_time) : '',
      expiration: token.expired_time && token.expired_time > 0 ? 'custom' : 'never',
      group: token.group ?? '',
      model_limits: token.model_limits ?? '',
      model_limits_enabled: Boolean(token.model_limits_enabled),
      remain_amount: toMoney(token.remain_quota ?? 0, quotaPolicy),
      unlimited_quota: Boolean(token.unlimited_quota),
    });
  }, [form, open, quotaPolicy, token]);

  const submit = async () => {
    const values = await form.validateFields();
    const expiredTime =
      values.expiration === 'never' ? -1 : Math.floor(new Date(values.expired_at).getTime() / 1000);
    if (!Number.isSafeInteger(expiredTime) || (expiredTime !== -1 && expiredTime <= 0)) {
      form.setFields([{ name: 'expired_at', errors: ['请选择有效的到期时间'] }]);
      return;
    }
    const patch: Parameters<typeof onSave>[0] = {};
    const allowIps = (values.allow_ips ?? '').trim();
    const group = (values.group ?? '').trim();
    const modelLimits = (values.model_limits ?? '').trim();
    const status = values.enabled ? (1 as const) : (2 as const);
    if (allowIps !== (token.allow_ips ?? '')) patch.allow_ips = allowIps;
    if (expiredTime !== token.expired_time) patch.expired_time = expiredTime;
    if (group !== (token.group ?? '')) patch.group = group;
    if (modelLimits !== (token.model_limits ?? '')) patch.model_limits = modelLimits;
    if (values.model_limits_enabled !== Boolean(token.model_limits_enabled))
      patch.model_limits_enabled = values.model_limits_enabled;
    if (status !== token.status) patch.status = status;
    if (values.unlimited_quota !== Boolean(token.unlimited_quota))
      patch.unlimited_quota = values.unlimited_quota;
    if (
      !values.unlimited_quota &&
      values.remain_amount !== toMoney(token.remain_quota ?? 0, quotaPolicy)
    ) {
      patch.remain_quota = toQuota(values.remain_amount ?? 0, quotaPolicy);
    }
    if (Object.keys(patch).length === 0) {
      message.info('配置没有变化');
      return;
    }
    const save = async () => {
      try {
        await onSave(patch);
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
        throw error;
      }
    };
    if (token.status === 1 && status === 2) {
      Modal.confirm({
        content: '禁用后，该用户当前绑定的 Token 将无法调用模型。',
        onOk: save,
        title: '确认禁用绑定 Token？',
      });
      return;
    }
    await save();
  };

  return (
    <Modal
      destroyOnHidden
      confirmLoading={loading}
      open={open}
      title={`编辑绑定 Token #${token.id}`}
      onCancel={onClose}
      onOk={submit}
    >
      <Form form={form} layout="vertical">
        <Form.Item label="名称">
          <Input disabled value={token.name} />
        </Form.Item>
        <Form.Item label="启用状态" name="enabled" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>
        <Form.Item label="过期时间" name="expiration">
          <Select
            options={[
              { label: '永不过期', value: 'never' },
              { label: '指定时间', value: 'custom' },
            ]}
          />
        </Form.Item>
        {expiration === 'custom' && (
          <Form.Item
            label="到期时间"
            name="expired_at"
            rules={[{ required: true, message: '请选择到期时间' }]}
          >
            <Input type="datetime-local" />
          </Form.Item>
        )}
        <Form.Item label="无限额度" name="unlimited_quota" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          label={`剩余额度（${quotaPolicy.quotaDisplayType}，约值）`}
          name="remain_amount"
          rules={[{ required: !unlimited, message: '请输入剩余额度' }]}
        >
          <InputNumber disabled={unlimited} min={0} precision={2} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="分组" name="group" rules={[{ max: 64, message: '最多 64 个字符' }]}>
          <Input />
        </Form.Item>
        <Form.Item label="限制模型" name="model_limits_enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        {modelLimitsEnabled && (
          <Form.Item
            label="允许的模型 ID（用逗号分隔）"
            name="model_limits"
            rules={[{ required: true, message: '开启模型限制后请输入模型 ID' }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        )}
        <Form.Item label="IP 白名单（用逗号分隔，留空表示不限制）" name="allow_ips">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
