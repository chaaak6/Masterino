import { trpc } from '@admin/lib/trpc';
import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { parseCatalogMcp } from './catalogImport';

export default function CatalogCreate({ type, onCreated, onCancel }: {
  type: 'mcp' | 'skill'; onCreated: () => void; onCancel: () => void;
}) {
  const [form] = Form.useForm();
  const [json, setJson] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [artifact, setArtifact] = useState<string>();
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');
  const verify = trpc.admin.verifyCatalogMcp.useMutation({ onError: e => setError(e.message) });
  const create = trpc.admin.createCatalogResource.useMutation({
    onError: e => setError(e.message),
    onSuccess: data => { setCreated(data.identifier); setHeaders({}); form.resetFields(); setJson(''); onCreated(); },
  });
  const connection = () => {
    const values = form.getFieldsValue();
    return { url: values.url, headers: { ...headers, ...(values.apiKey ? { Authorization: `Bearer ${values.apiKey}` } : {}) } };
  };
  if (created) return <Alert type="success" showIcon message={`已提交 ${created}`} description={<Space>前往审核与发布完成发布。<Link to="/market">审核与发布</Link><Button onClick={onCancel}>完成</Button></Space>} />;
  return <Card title={type === 'mcp' ? '创建 MCP' : '创建或上传 Skill'}>
    <Space direction="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}
      {type === 'mcp' && <>
        <Input.TextArea rows={4} placeholder="粘贴 mcpServers JSON（可包含 headers）" value={json} onChange={e => setJson(e.target.value)} />
        <Button onClick={() => { try { const parsed = parseCatalogMcp(json); setHeaders(Object.fromEntries(Object.entries(parsed.headers).filter(([key]) => key.toLowerCase() !== 'authorization'))); form.setFieldsValue({ identifier: parsed.identifier, name: parsed.identifier, url: parsed.url, apiKey: parsed.headers.Authorization?.replace(/^Bearer\s+/i, '') }); setError(''); setJson(''); } catch (e) { setError((e as Error).message); } }}>导入 JSON 到表单</Button>
      </>}
      <Form form={form} layout="vertical" initialValues={{ version: '1.0.0' }} onFinish={values => {
        setError('');
        create.mutate({ type, identifier: values.identifier, name: values.name, description: values.description || '', category: values.category, version: values.version,
          ...(type === 'mcp' ? { connection: connection() } : { artifactBase64: artifact, skillContent: values.skillContent }) });
      }}>
        <Form.Item name="identifier" label="标识符" rules={[{ required: true }, { pattern: /^[a-zA-Z0-9_-]+$/, message: '使用英文、数字、下划线或短横线' }]}><Input /></Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
        <Space align="start"><Form.Item name="category" label="分类"><Input placeholder="例如 information-retrieval" /></Form.Item><Form.Item name="version" label="版本" rules={[{ required: true }]}><Input /></Form.Item></Space>
        {type === 'mcp' ? <>
          <Form.Item name="url" label="Streamable HTTP URL" rules={[{ required: true, type: 'url' }]}><Input /></Form.Item>
          <Form.Item name="apiKey" label="公司共用 API Key"><Input.Password autoComplete="new-password" /></Form.Item>
          <Typography.Paragraph type="secondary">留空表示无需认证。公司 Key 保存在服务端，用户安装时无需填写。</Typography.Paragraph>
          <Button loading={verify.isPending} onClick={async () => { try { await form.validateFields(['url']); setError(''); verify.mutate(connection()); } catch { /* field errors are shown by the form */ } }}>测试连接</Button>
          {verify.data && <Alert type="success" message={`发现 ${verify.data.tools.length} 个工具`} description={verify.data.tools.map(t => t.name).join('、')} style={{ marginTop: 12 }} />}
        </> : <>
          <Typography.Paragraph>上传 ZIP（根目录含 SKILL.md，最多 16 MiB），或直接编写 SKILL.md。</Typography.Paragraph>
          <input aria-label="Skill ZIP" type="file" accept=".zip" onChange={async e => {
            const file = e.target.files?.[0]; if (!file) { setArtifact(undefined); return; }
            if (file.size > 16 * 1024 * 1024) { setError('ZIP 不能超过 16 MiB'); e.target.value = ''; return; }
            const reader = new FileReader(); reader.onload = () => { setArtifact(String(reader.result).split(',')[1]); setError(''); }; reader.readAsDataURL(file);
          }} />
          <Form.Item name="skillContent" label="SKILL.md 内容" rules={[{ validator: async (_, value) => { if (!artifact && !value?.trim()) throw new Error('请上传 ZIP 或填写 SKILL.md'); } }]}><Input.TextArea rows={8} disabled={!!artifact} placeholder={'---\nname: my-skill\ndescription: 技能描述\n---\n\n技能操作说明'} /></Form.Item>
        </>}
        <Space style={{ marginTop: 16 }}><Button htmlType="submit" type="primary" loading={create.isPending}>提交审核</Button><Button onClick={onCancel}>取消</Button></Space>
      </Form>
    </Space>
  </Card>;
}
