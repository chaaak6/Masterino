import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import AdminShell from './layout/AdminShell';
import RequireAdmin from './layout/RequireAdmin';
import { trpc, trpcClient } from './lib/trpc';
import AccessKeysPage from './pages/AccessKeysPage';
import AgentsPage from './pages/AgentsPage';
import AuditPage from './pages/AuditPage';
import KnowledgePage from './pages/KnowledgePage';
import MarketPage from './pages/MarketPage';
import McpPage from './pages/McpPage';
import ModelCatalogPage from './pages/ModelCatalogPage';
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
      { element: <AccessKeysPage />, path: 'access-keys' },
      { element: <ModelCatalogPage />, path: 'models' },
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
        element: <AgentsPage />,
        path: 'agents',
      },
      {
        element: <SkillsPage />,
        path: 'skills',
      },
      {
        element: <McpPage />,
        path: 'mcp',
      },
      {
        element: <MarketPage />,
        path: 'market',
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
