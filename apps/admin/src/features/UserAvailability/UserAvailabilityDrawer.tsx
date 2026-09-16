import { trpc } from '@admin/lib/trpc';
import type { LambdaRouter } from '@masterlion/server/routers/lambda';
import type { inferRouterOutputs } from '@trpc/server';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useLayoutEffect, useState } from 'react';

import BoundTokenEditor from './BoundTokenEditor';

type Availability = inferRouterOutputs<LambdaRouter>['admin']['getUserAvailability'];

const tokenLabels: Record<Availability['token']['status'], string> = {
  active: '可用',
  deleted: '已删除',
  disabled: '已禁用',
  exhausted: 'Token 额度耗尽',
  expired: '已过期',
  missing: '不存在',
  owner_mismatch: '归属不匹配',
  unbound: '未绑定',
  unknown: '暂时无法查询',
};

const healthLabels: Record<Availability['health'], string> = {
  active: '可用',
  blocked: '不可用',
  uninitialized: '未初始化',
  unknown: '待确认',
};

interface UserAvailabilityDrawerProps {
  onClose: () => void;
  onUpdated: () => Promise<unknown>;
  userId?: string;
}

export default function UserAvailabilityDrawer({
  onClose,
  onUpdated,
  userId,
}: UserAvailabilityDrawerProps) {
  const [editingUserId, setEditingUserId] = useState<string>();
  const [feedback, setFeedback] = useState<{
    message: string;
    type: 'error' | 'success' | 'warning';
  } | null>(null);
  useEffect(() => setFeedback(null), [userId]);
  useLayoutEffect(() => {
    setEditingUserId(undefined);
  }, [userId]);
  const availability = trpc.admin.getUserAvailability.useQuery(
    { userId: userId! },
    { enabled: Boolean(userId), retry: false },
  );
  const rerun = trpc.admin.rerunAihubReadiness.useMutation();
  const sync = trpc.admin.syncUserModels.useMutation();
  const updateToken = trpc.admin.updateBoundAihubToken.useMutation();
  const detail = availability.data?.masterino.id === userId ? availability.data : undefined;
  const token = detail?.token.inspection?.token;

  const refresh = async () => {
    await Promise.all([availability.refetch(), onUpdated()]);
  };

  const rerunReadiness = async () => {
    if (!userId) return;
    setFeedback(null);
    try {
      const result = await rerun.mutateAsync({ userId });
      await refresh();
      setFeedback(
        result.status === 'active'
          ? { message: 'Readiness 已重新检查完成', type: 'success' }
          : { message: result.errorMessage || `Readiness 状态：${result.status}`, type: 'warning' },
      );
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : String(error), type: 'error' });
    }
  };

  const syncModels = async () => {
    if (!userId) return;
    setFeedback(null);
    try {
      const result = await sync.mutateAsync({ userId });
      await refresh();
      setFeedback({
        message: `已同步 ${result.modelCount} 个各类模型；上方仅统计可用的聊天模型。用户重启 App 或刷新网页后获取最新列表`,
        type: 'success',
      });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : String(error), type: 'error' });
    }
  };

  return (
    <Drawer
      destroyOnHidden
      loading={availability.isLoading}
      open={Boolean(userId)}
      size="large"
      title="用户可用性"
      onClose={() => {
        setEditingUserId(undefined);
        onClose();
      }}
    >
      {availability.error && (
        <Alert
          showIcon
          action={<Button onClick={() => availability.refetch()}>重试</Button>}
          message={availability.error.message}
          type="error"
        />
      )}
      {feedback && (
        <Alert
          closable
          showIcon
          message={feedback.message}
          type={feedback.type}
          onClose={() => setFeedback(null)}
        />
      )}
      {detail && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Alert
            showIcon
            message={`${detail.masterino.name} · ${healthLabels[detail.health]}`}
            description={
              detail.token.status !== 'active'
                ? `绑定 Token：${tokenLabels[detail.token.status]}`
                : detail.models.count === 0
                  ? '当前没有可用模型记录'
                  : undefined
            }
            type={
              detail.health === 'active'
                ? 'success'
                : detail.health === 'unknown'
                  ? 'warning'
                  : 'error'
            }
          />

          <Descriptions bordered column={1} size="small" title="Masterino">
            <Descriptions.Item label="工号">
              {detail.masterino.employeeNumber || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="用户 ID">
              <Typography.Text copyable>{detail.masterino.id}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="账号状态">
              <Tag color={detail.masterino.banned ? 'error' : 'success'}>
                {detail.masterino.banned ? '已禁用' : '正常'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Readiness">
              {detail.binding
                ? `${detail.binding.status} / v${detail.binding.readinessVersion}`
                : '未初始化'}
            </Descriptions.Item>
            {detail.binding?.errorMessage && (
              <Descriptions.Item label="最近错误">{detail.binding.errorMessage}</Descriptions.Item>
            )}
            <Descriptions.Item label="聊天模型">
              {detail.models.count} 个 · 最近更新{' '}
              {detail.models.lastUpdatedAt
                ? new Date(detail.models.lastUpdatedAt).toLocaleString('zh-CN')
                : '未知'}
            </Descriptions.Item>
          </Descriptions>
          <Space wrap>
            <Popconfirm
              description="重新检查身份和绑定，可能创建或修复托管 Token；不会给已有用户自动充值。"
              title="确认重新执行 Readiness？"
              onConfirm={rerunReadiness}
            >
              <Button loading={rerun.isPending}>重新执行 Readiness</Button>
            </Popconfirm>
            <Button
              disabled={!detail.binding?.managedTokenId}
              loading={sync.isPending}
              onClick={syncModels}
            >
              手动刷新模型
            </Button>
          </Space>

          <Descriptions bordered column={1} size="small" title="Aihub">
            <Descriptions.Item label="Aihub 用户 ID">
              {detail.aihub?.id ?? '未绑定或未找到'}
            </Descriptions.Item>
            <Descriptions.Item label="用户名">{detail.aihub?.username || '-'}</Descriptions.Item>
            <Descriptions.Item label="用户状态">
              {detail.aihub?.status === 1 ? '已启用' : detail.aihub ? '未启用' : '未知'}
            </Descriptions.Item>
            <Descriptions.Item label="分组">{detail.aihub?.group || '-'}</Descriptions.Item>
            <Descriptions.Item label="钱包余额">
              {detail.aihub?.walletAmount == null
                ? '未知'
                : `约 ¥${detail.aihub.walletAmount.toFixed(2)}`}
            </Descriptions.Item>
          </Descriptions>

          <Descriptions bordered column={1} size="small" title="Masterino 绑定 Token">
            <Descriptions.Item label="Token ID">
              {detail.binding?.managedTokenId ?? '未绑定'}
            </Descriptions.Item>
            <Descriptions.Item label="实际状态">
              <Tag color={detail.token.status === 'active' ? 'success' : 'error'}>
                {tokenLabels[detail.token.status]}
              </Tag>
            </Descriptions.Item>
            {detail.token.error && (
              <Descriptions.Item label="查询错误">{detail.token.error}</Descriptions.Item>
            )}
            {token && (
              <>
                <Descriptions.Item label="名称">{token.name}</Descriptions.Item>
                <Descriptions.Item label="过期时间">
                  {token.expired_time === -1
                    ? '永不过期'
                    : token.expired_time
                      ? new Date(token.expired_time * 1000).toLocaleString('zh-CN')
                      : '未知'}
                </Descriptions.Item>
                <Descriptions.Item label="无限额度">
                  {token.unlimited_quota ? '已开启' : '未开启'}
                </Descriptions.Item>
                <Descriptions.Item label="Token 分组">{token.group || '-'}</Descriptions.Item>
                <Descriptions.Item label="模型限制">
                  {token.model_limits_enabled ? token.model_limits || '未设置' : '未开启'}
                </Descriptions.Item>
                <Descriptions.Item label="IP 白名单">
                  {token.allow_ips || '未限制'}
                </Descriptions.Item>
              </>
            )}
          </Descriptions>
          {token && detail.token.status !== 'deleted' && (
            <Button onClick={() => setEditingUserId(userId)}>编辑绑定 Token 配置</Button>
          )}
          {token && (
            <BoundTokenEditor
              loading={updateToken.isPending}
              open={Boolean(userId && editingUserId === userId)}
              quotaPolicy={detail.quotaPolicy}
              token={token}
              onClose={() => setEditingUserId(undefined)}
              onSave={async (patch) => {
                setFeedback(null);
                try {
                  await updateToken.mutateAsync({ patch, userId: detail.masterino.id });
                  setEditingUserId(undefined);
                  await refresh();
                  setFeedback({
                    message: '绑定 Token 配置已保存。若修改了模型范围，请手动刷新该用户模型。',
                    type: 'success',
                  });
                } catch (error) {
                  setFeedback({
                    message: error instanceof Error ? error.message : String(error),
                    type: 'error',
                  });
                  throw error;
                }
              }}
            />
          )}
        </Space>
      )}
    </Drawer>
  );
}
