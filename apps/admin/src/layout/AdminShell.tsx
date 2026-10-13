import type { MenuProps } from 'antd';
import { Layout, Menu, Typography } from 'antd';
import {
  Bot,
  Database,
  KeyRound,
  LayoutDashboard,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  Workflow,
} from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';

const { Content, Header, Sider } = Layout;

const navItems: MenuProps['items'] = [
  {
    icon: <LayoutDashboard size={18} />,
    key: '/',
    label: <Link to="/">总览</Link>,
  },
  {
    icon: <Users size={18} />,
    key: '/users',
    label: <Link to="/users">用户</Link>,
  },
  {
    icon: <Workflow size={18} />,
    key: '/workspaces',
    label: <Link to="/workspaces">工作区</Link>,
  },
  {
    icon: <ShieldCheck size={18} />,
    key: '/roles',
    label: <Link to="/roles">角色权限</Link>,
  },
  {
    icon: <KeyRound size={18} />,
    key: '/sso',
    label: <Link to="/sso">SSO</Link>,
  },
  {
    icon: <Database size={18} />,
    key: '/knowledge',
    label: <Link to="/knowledge">知识库</Link>,
  },
  {
    children: [
      {
        icon: <Bot size={18} />,
        key: '/agents',
        label: <Link to="/agents">Agents</Link>,
      },
      {
        icon: <Sparkles size={18} />,
        key: '/skills',
        label: <Link to="/skills">Skills</Link>,
      },
      {
        icon: <Plug size={18} />,
        key: '/mcp',
        label: <Link to="/mcp">MCP</Link>,
      },
    ],
    key: 'catalog',
    label: '资源目录',
  },
  { icon: <Database size={18} />, key: '/models', label: <Link to="/models">模型说明</Link> },
  {
    icon: <Store size={18} />,
    key: '/market',
    label: <Link to="/market">审核与发布</Link>,
  },
  {
    icon: <KeyRound size={18} />,
    key: '/access-keys',
    label: <Link to="/access-keys">访问 Key</Link>,
  },
  {
    icon: <ScrollText size={18} />,
    key: '/audit',
    label: <Link to="/audit">审计日志</Link>,
  },
  {
    icon: <Settings size={18} />,
    key: '/config',
    label: <Link to="/config">系统配置</Link>,
  },
];

export default function AdminShell() {
  const location = useLocation();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={232}>
        <Typography.Title level={4} style={{ margin: 24 }}>
          Masterino
        </Typography.Title>
        <Menu
          defaultOpenKeys={['catalog']}
          items={navItems}
          mode="inline"
          selectedKeys={[location.pathname]}
        />
      </Sider>
      <Layout>
        <Header
          style={{ alignItems: 'center', background: '#fff', display: 'flex', paddingInline: 24 }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            企业管理后台
          </Typography.Title>
        </Header>
        <Content style={{ background: '#f7f8fa', padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
