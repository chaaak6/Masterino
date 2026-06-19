import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import AdminShell from './layout/AdminShell';
import RequireAdmin from './layout/RequireAdmin';
import { trpc, trpcClient } from './lib/trpc';
import AuditPage from './pages/AuditPage';
import KnowledgePage from './pages/KnowledgePage';
import McpPage from './pages/McpPage';
import OverviewPage from './pages/OverviewPage';
import RolesPage from './pages/RolesPage';
import SkillsPage from './pages/SkillsPage';
import SsoPage from './pages/SsoPage';
import SystemConfigPage from './pages/SystemConfigPage';
import UsersPage from './pages/UsersPage';
import WorkspacesPage from './pages/WorkspacesPage';

const queryClient = new QueryClient();
const providerQueryClient = queryClient as unknown as React.ComponentProps<
  typeof trpc.Provider
>['queryClient'];

const router = createBrowserRouter([
  {
    children: [
      {
        element: <OverviewPage />,
        index: true,
      },
      {
        element: <UsersPage />,
        path: 'users',
      },
      {
        element: <WorkspacesPage />,
        path: 'workspaces',
      },
      {
        element: <RolesPage />,
        path: 'roles',
      },
      {
        element: <SsoPage />,
        path: 'sso',
      },
      {
        element: <SystemConfigPage />,
        path: 'config',
      },
      {
        element: <AuditPage />,
        path: 'audit',
      },
      {
        element: <KnowledgePage />,
        path: 'knowledge',
      },
      {
        element: <SkillsPage />,
        path: 'skills',
      },
      {
        element: <McpPage />,
        path: 'mcp',
      },
    ],
    element: (
      <RequireAdmin>
        <AdminShell />
      </RequireAdmin>
    ),
    path: '/',
  },
]);

export default function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <trpc.Provider client={trpcClient} queryClient={providerQueryClient}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </trpc.Provider>
    </ConfigProvider>
  );
}
