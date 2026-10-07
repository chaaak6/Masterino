import './style.css';

import { ThemeProvider } from '@lobehub/ui';
import { App as AntApp } from 'antd';
import i18n from 'i18next';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';

import en from '../../../locales/en-US/aihub.json';
import zh from '../../../locales/zh-CN/aihub.json';
import NewApiBalance from '../../../src/features/User/NewApiBalance';
import Page from '../../../src/routes/(main)/settings/provider/detail/newapi';

await i18n
  .use(initReactI18next)
  .init({
    lng: new URLSearchParams(location.search).get('lang') || 'zh-CN',
    fallbackLng: 'en-US',
    resources: { 'zh-CN': { aihub: zh }, 'en-US': { aihub: en } },
    showSupportNotice: false,
  });
function Preview() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="test-banner">测试环境预览 · 示例账户与订阅数据 · 不执行扣费或模型同步</div>
      <div className="shell">
        <aside>
          <div className="brand">小宗狮 AI</div>
          <button className="avatar" onClick={() => setOpen(!open)}>
            测<span>测试用户</span>
          </button>
          {open && (
            <div className="menu">
              <strong style={{ padding: '12px 16px', display: 'block' }}>测试用户</strong>
              <div className="stats">
                <a href="/settings/stats">0 助理 57 话题 1,436 消息</a>
              </div>
              <Link to="/settings/provider/newapi" onClick={() => setOpen(false)}>
                <NewApiBalance />
              </Link>
            </div>
          )}
          <p>设置</p>
          <a className="nav" href="/settings/stats">
            数据统计
          </a>
          <Link className="nav selected" to="/settings/provider/newapi">
            AI 服务商
          </Link>
          <span className="nav">服务模型</span>
        </aside>
        <main>
          <Routes>
            <Route element={<Page />} path="*" />
          </Routes>
        </main>
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <ThemeProvider appearance="light">
    <AntApp>
      <BrowserRouter>
        <Preview />
      </BrowserRouter>
    </AntApp>
  </ThemeProvider>,
);
