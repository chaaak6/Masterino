import { trpc, trpcClient } from '@admin/lib/trpc';
import { SKILL_SOURCE_MAX_BYTES } from '@lobechat/skill-package';
import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { parseCatalogMcp } from './catalogImport';

export default function CatalogCreate({
  type,
  onCreated,
  onCancel,
}: {
  type: 'mcp' | 'skill';
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [form] = Form.useForm();
  const [json, setJson] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [artifact, setArtifact] = useState<string>();
  const [fileName, setFileName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const fileReader = useRef<AbortController | null>(null);
  const removeZip = () => {
    fileReader.current?.abort();
    fileReader.current = null;
    setArtifact(undefined);
    setFileName('');
    if (fileInput.current) fileInput.current.value = '';
  };
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');
  const verify = trpc.admin.verifyCatalogMcp.useMutation({ onError: (e) => setError(e.message) });
  const create = trpc.admin.createCatalogResource.useMutation({
    onError: (e) => setError(e.message),
    onSuccess: (data) => {
      setCreated(data.identifier);
      setHeaders({});
      setArtifact(undefined);
      form.resetFields();
      setJson('');
      onCreated();
    },
  });
  const connection = () => {
    const values = form.getFieldsValue();
    return {
      url: values.url,
      headers: {
        ...headers,
        ...(values.apiKey ? { Authorization: `Bearer ${values.apiKey}` } : {}),
      },
    };
  };
  if (created)
    return (
      <Alert
        showIcon
        message={`已提交 ${created}`}
        type="success"
        description={
          <Space>
            前往审核与发布完成发布。<Link to="/market">审核与发布</Link>
            <Button onClick={onCancel}>完成</Button>
          </Space>
        }
      />
    );
  return (
    <Card title={type === 'mcp' ? '创建 MCP' : '创建或上传 Skill'}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {error && <Alert showIcon message={error} type="error" />}
        {type === 'mcp' && (
          <>
            <Input.TextArea
              placeholder="粘贴 mcpServers JSON（可包含 headers）"
              rows={4}
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
            <Button
              onClick={() => {
                try {
                  const parsed = parseCatalogMcp(json);
                  setHeaders(
                    Object.fromEntries(
                      Object.entries(parsed.headers).filter(
                        ([key]) => key.toLowerCase() !== 'authorization',
                      ),
                    ),
                  );
                  form.setFieldsValue({
                    identifier: parsed.identifier,
                    name: parsed.identifier,
                    url: parsed.url,
                    apiKey: Object.entries(parsed.headers)
                      .find(([key]) => key.toLowerCase() === 'authorization')?.[1]
                      .replace(/^Bearer\s+/i, ''),
                  });
                  setError('');
                  setJson('');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              导入 JSON 到表单
            </Button>
          </>
        )}
        <Form
          form={form}
          initialValues={{ version: '1.0.0' }}
          layout="vertical"
          onValuesChange={() => verify.reset()}
          onFinish={(values) => {
            setError('');
            if (fileName && !artifact) {
              setError('ZIP 正在上传，请稍后提交');
              return;
            }
            create.mutate({
              type,
              identifier: values.identifier,
              name: values.name,
              description: values.description || '',
              category: values.category,
              version: values.version,
              ...(type === 'mcp'
                ? { connection: connection() }
                : { artifactFileId: artifact, skillContent: values.skillContent }),
            });
          }}
        >
          <Form.Item
            label="标识符"
            name="identifier"
            rules={[
              { required: true },
              { pattern: /^[\w-]+$/, message: '使用英文、数字、下划线或短横线' },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space align="start">
            <Form.Item label="分类" name="category">
              <Input placeholder="例如 information-retrieval" />
            </Form.Item>
            <Form.Item label="版本" name="version" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Space>
          {type === 'mcp' ? (
            <>
              <Form.Item
                label="Streamable HTTP URL"
                name="url"
                rules={[{ required: true, type: 'url' }]}
              >
                <Input />
              </Form.Item>
              <Form.Item label="公司共用 API Key" name="apiKey">
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Typography.Paragraph type="secondary">
                留空表示无需认证。公司 Key 保存在服务端，用户安装时无需填写。
              </Typography.Paragraph>
              <Button
                loading={verify.isPending}
                onClick={async () => {
                  try {
                    await form.validateFields(['url']);
                    setError('');
                    verify.mutate(connection());
                  } catch {
                    /* field errors are shown by the form */
                  }
                }}
              >
                测试连接
              </Button>
              {verify.data && (
                <Alert
                  description={verify.data.tools.map((t) => t.name).join('、')}
                  message={`发现 ${verify.data.tools.length} 个工具`}
                  style={{ marginTop: 12 }}
                  type="success"
                />
              )}
            </>
          ) : (
            <>
              <Typography.Paragraph>
                上传 ZIP（包含 SKILL.md，源包最多 64 MiB，规范化技能最多 32 MiB），或直接编写
                SKILL.md。
              </Typography.Paragraph>
              <input
                accept=".zip"
                aria-label="Skill ZIP"
                ref={fileInput}
                type="file"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  fileReader.current?.abort();
                  fileReader.current = null;
                  setArtifact(undefined);
                  setFileName('');
                  if (!file) return;
                  if (file.size > SKILL_SOURCE_MAX_BYTES) {
                    setError('ZIP 不能超过 64 MiB');
                    e.target.value = '';
                    return;
                  }
                  setFileName(file.name);
                  const controller = new AbortController();
                  fileReader.current = controller;
                  try {
                    const bytes = await file.arrayBuffer();
                    const digest = await crypto.subtle.digest('SHA-256', bytes);
                    const hash = Array.from(new Uint8Array(digest), (b) =>
                      b.toString(16).padStart(2, '0'),
                    ).join('');
                    const key = `skills/${crypto.randomUUID()}.zip`;
                    const signed = await trpcClient.upload.createS3PreSignedUpload.mutate({
                      pathname: key,
                      source: 'skill',
                      size: file.size,
                      hash,
                    });
                    const uploadUrl = new URL(signed.url, window.location.origin);
                    if (uploadUrl.pathname !== '/api/upload/s3-proxy')
                      throw new Error('上传地址无效，请重试');
                    const response = await fetch(uploadUrl.pathname + uploadUrl.search, {
                      method: 'PUT',
                      body: file,
                      signal: controller.signal,
                      headers: { 'content-type': 'application/zip' },
                    });
                    if (!response.ok) throw new Error(await response.text());
                    if (response.headers.get('X-Masterino-Upload-Confirmed') !== '1')
                      throw new Error('上传未确认，请重试');
                    const record = await trpcClient.file.createFile.mutate({
                      fileType: 'application/zip',
                      hash,
                      metadata: {},
                      name: file.name,
                      size: file.size,
                      url: key,
                    });
                    if (!controller.signal.aborted) {
                      setArtifact(record.id);
                      setError('');
                    }
                  } catch (error) {
                    if (!controller.signal.aborted) {
                      removeZip();
                      setError((error as Error).message);
                    }
                  }
                }}
              />
              {fileName && (
                <Space>
                  <Typography.Text>已选择：{fileName}</Typography.Text>
                  <Button onClick={removeZip}>移除 ZIP</Button>
                </Space>
              )}
              <Form.Item
                label="SKILL.md 内容"
                name="skillContent"
                rules={[
                  {
                    validator: async (_, value) => {
                      if (!artifact && !value?.trim())
                        throw new Error('请上传 ZIP 或填写 SKILL.md');
                    },
                  },
                ]}
              >
                <Input.TextArea
                  disabled={!!fileName}
                  placeholder={'---\nname: my-skill\ndescription: 技能描述\n---\n\n技能操作说明'}
                  rows={8}
                />
              </Form.Item>
            </>
          )}
          <Space style={{ marginTop: 16 }}>
            <Button htmlType="submit" loading={create.isPending} type="primary">
              提交审核
            </Button>
            <Button onClick={onCancel}>取消</Button>
          </Space>
        </Form>
      </Space>
    </Card>
  );
}
