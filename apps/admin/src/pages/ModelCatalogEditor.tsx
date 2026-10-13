import {
  MANAGED_MODEL_CAPABILITIES,
  MANAGED_MODEL_MODALITIES,
  type ManagedModelDescription,
  ManagedModelDescriptionSchema,
  type ManagedModelRecord,
} from '@lobechat/types';
import { Button, Modal, Select, Switch } from '@lobehub/ui/base-ui';
import { Alert, Divider, Form, Input, InputNumber, Space, Typography } from 'antd';
import { useState } from 'react';

export const capabilityLabels: Record<string, string> = {
  text: '文本输入',
  image: '图片输入',
  audio: '音频输入',
  video: '视频输入',
  file: '文件输入',
  functionCall: '工具调用',
  reasoning: '推理',
  structuredOutput: '结构化输出',
  search: '联网搜索',
  imageOutput: '图像输出',
};
const evidenceOptions = [
  { value: 'unknown', label: '待确认' },
  { value: 'supported', label: '支持' },
  { value: 'unsupported', label: '不支持' },
];
const kinds = [
  'chat',
  'embedding',
  'image',
  'video',
  'tts',
  'stt',
  'rerank',
  'moderation',
  'unknown',
];
const kindLabels = [
  '聊天',
  '向量',
  '图像生成',
  '视频生成',
  '语音合成',
  '语音识别',
  '重排序',
  '内容审核',
  '待确认',
];

export default function ModelCatalogEditor({
  record,
  modelId,
  initial,
  saving,
  onSave,
  onClose,
}: {
  record?: ManagedModelRecord;
  modelId: string;
  initial: ManagedModelDescription;
  saving: boolean;
  onSave: (draft: ManagedModelDescription) => void;
  onClose: () => void;
}) {
  const [form] = Form.useForm<ManagedModelDescription>();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState(!!initial.referencePricing);
  const [confirmClose, setConfirmClose] = useState(false);
  return (
    <>
      <Modal
        open
        maskClosable={false}
        title={`维护模型说明 · ${modelId}`}
        width={860}
        footer={
          <Space>
            <Button disabled={saving} onClick={() => (dirty ? setConfirmClose(true) : onClose())}>
              取消
            </Button>
            <Button
              loading={saving}
              type="primary"
              onClick={() => {
                const parsed = ManagedModelDescriptionSchema.safeParse({
                  ...form.getFieldsValue(true),
                  referencePricing: reference ? form.getFieldValue('referencePricing') : null,
                });
                if (!parsed.success) {
                  setError(
                    '请检查模型名称、资料链接、容量和参考价来源；容量须为正整数，价格不能为负数。',
                  );
                  return;
                }
                setError('');
                onSave(parsed.data);
              }}
            >
              保存草稿
            </Button>
          </Space>
        }
        onCancel={() => (dirty ? setConfirmClose(true) : onClose())}
      >
        <Alert
          showIcon
          type="info"
          message={
            record?.published
              ? '保存草稿不会改变客户端当前已发布版本。'
              : '保存后需发布，客户端才能读取这份模型说明。'
          }
        />
        {error && <Alert message={error} role="alert" style={{ marginTop: 12 }} type="error" />}
        <Form
          form={form}
          initialValues={initial}
          layout="vertical"
          style={{ marginTop: 16 }}
          onValuesChange={() => setDirty(true)}
        >
          <Typography.Text type="secondary">
            调用 ID：{modelId}（精确匹配 Aihub 模型，不改变调用 ID）
          </Typography.Text>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
              gap: '0 16px',
              marginTop: 12,
            }}
          >
            <Form.Item required label="展示名称" name="displayName">
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item label="厂商 / 品牌" name="organization">
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item label="模型类别" name="kind">
              <Select
                options={kinds.map((value, index) => ({ value, label: kindLabels[index] }))}
              />
            </Form.Item>
            <Form.Item label="资料链接" name="sourceUrl">
              <Input placeholder="https://…" />
            </Form.Item>
            <Form.Item label="上下文大小（tokens）" name="contextWindowTokens">
              <InputNumber
                min={1}
                placeholder="未验证留空"
                precision={0}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item label="最大输出（tokens）" name="maxOutput">
              <InputNumber
                min={1}
                placeholder="未验证留空"
                precision={0}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </div>
          <Form.Item label="模型简介 / 推荐用途" name="description">
            <Input.TextArea maxLength={10000} rows={3} />
          </Form.Item>
          <Form.Item label="使用限制 / 参数说明" name="limitations">
            <Input.TextArea maxLength={10000} rows={2} />
          </Form.Item>
          <Divider titlePlacement="start">能力范围</Divider>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
              gap: '0 16px',
            }}
          >
            {MANAGED_MODEL_MODALITIES.map((key) => (
              <Form.Item key={key} label={capabilityLabels[key]} name={['inputModalities', key]}>
                <Select options={evidenceOptions} />
              </Form.Item>
            ))}
            {MANAGED_MODEL_CAPABILITIES.map((key) => (
              <Form.Item key={key} label={capabilityLabels[key]} name={['capabilities', key]}>
                <Select options={evidenceOptions} />
              </Form.Item>
            ))}
          </div>
          <Divider titlePlacement="start">参考价</Divider>
          <Space>
            <Switch
              checked={reference}
              onChange={(checked) => {
                setReference(checked);
                setDirty(true);
                if (checked && !form.getFieldValue('referencePricing'))
                  form.setFieldValue('referencePricing', {
                    currency: 'CNY',
                    input: null,
                    output: null,
                    cacheRead: null,
                    cacheWrite: null,
                    source: '',
                  });
              }}
            />
            <Typography.Text>维护官方 / 参考价</Typography.Text>
          </Space>
          <Typography.Paragraph type="secondary">
            参考价按百万 tokens 计，仅用于说明，不改变 Aihub 实际扣费。
          </Typography.Paragraph>
          {reference && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                gap: '0 16px',
              }}
            >
              <Form.Item label="币种" name={['referencePricing', 'currency']}>
                <Select
                  options={[
                    { value: 'CNY', label: '人民币' },
                    { value: 'USD', label: '美元' },
                  ]}
                />
              </Form.Item>
              {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((key, index) => (
                <Form.Item
                  key={key}
                  label={['输入参考价', '输出参考价', '缓存读取参考价', '缓存写入参考价'][index]}
                  name={['referencePricing', key]}
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              ))}
              <Form.Item required label="参考价来源" name={['referencePricing', 'source']}>
                <Input maxLength={1000} />
              </Form.Item>
            </div>
          )}
        </Form>
      </Modal>
      <Modal
        cancelText="继续编辑"
        okText="放弃修改"
        open={confirmClose}
        title="放弃未保存的修改？"
        onCancel={() => setConfirmClose(false)}
        onOk={onClose}
      >
        已发布版本不会受到影响。
      </Modal>
    </>
  );
}
