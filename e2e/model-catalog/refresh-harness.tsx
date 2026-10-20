import { ManagedModelDescriptionSchema } from '@lobechat/types';
import { MotionProvider, ThemeProvider } from '@lobehub/ui';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import i18n from 'i18next';
import { motion } from 'motion/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import superjson from 'superjson';

import components from '../../locales/zh-CN/components.json';
import {
  getCatalogCheckStatus,
  MANUAL_MODEL_REFRESH_EVENT,
  requestPanelModelCatalogCheck,
  retryPanelModelCatalogCheck,
  SilentModelRefreshController,
  subscribeCatalogCheckStatus,
} from '../../src/features/SilentModelRefresh/controller';

i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  keySeparator: false,
  resources: { 'zh-CN': { components } },
  interpolation: { escapeValue: false },
});

const client = createTRPCClient<any>({
  links: [httpBatchLink({ url: '/trpc/lambda', transformer: superjson })],
});
function HarnessDescription({ description }: { description: unknown }) {
  const parsed = ManagedModelDescriptionSchema.safeParse(description);
  if (!parsed.success) return null;
  const value = parsed.data;
  return (
    <details>
      <summary>模型说明</summary>
      <p>最大输出 tokens：{value.maxOutput?.toLocaleString() ?? '待确认'}</p>
      <p>
        工具调用：
        {value.capabilities.functionCall === 'unknown'
          ? '待确认'
          : value.capabilities.functionCall === 'supported'
            ? '支持'
            : '不支持'}
      </p>
    </details>
  );
}
function Harness() {
  const [models, setModels] = useState<any[]>([{ id: 'old', displayName: '原有模型' }]);
  const [revision, setRevision] = useState('');
  const [checks, setChecks] = useState(0);
  const [selected, setSelected] = useState('bdd-chat');
  const [running, setRunning] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState('');
  const checkStatus = useSyncExternalStore(subscribeCatalogCheckStatus, getCatalogCheckStatus);
  useEffect(() => {
    const controller = new SilentModelRefreshController({
      check: (knownRevision, signal) => {
        setChecks((v) => v + 1);
        return client.modelCatalog.check.query({ knownRevision }, { signal });
      },
      apply: (response) => {
        setModels(response.models);
        setRevision(response.revision);
      },
      clear: () => {
        setModels([{ id: 'old', displayName: '原有模型' }]);
        setRevision('');
      },
    });
    return controller.start();
  }, []);
  return (
    <main>
      <h1>主界面模型目录</h1>
      <p data-testid="checks">{checks}</p>
      <p data-testid="revision">{revision}</p>
      <p data-testid="selected">{selected}</p>
      <button
        onClick={() =>
          setRunning(
            models.find((m) => m.id === selected)?.contextWindowTokens?.toString() ?? 'unknown',
          )
        }
      >
        开始任务
      </button>
      <p data-testid="running">{running}</p>
      <button
        onClick={() => {
          setPanelOpen((value) => !value);
          if (!panelOpen) requestPanelModelCatalogCheck();
        }}
      >
        {panelOpen ? '关闭模型面板' : '打开模型面板'}
      </button>
      {panelOpen && (
        <section aria-label="模型面板" data-testid="model-panel">
          <input
            aria-label="搜索面板模型"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {checkStatus === 'error' && (
            <button onClick={retryPanelModelCatalogCheck}>模型信息暂未更新 · 重试</button>
          )}
          {models
            .filter((model) =>
              (model.displayName ?? model.id).toLowerCase().includes(search.toLowerCase()),
            )
            .map((model) => (
              <p key={model.id}>{model.displayName ?? model.id}</p>
            ))}
          <p data-testid="panel-detail">
            {models.find((model) => model.id === selected)?.settings?.managedModelCatalog
              ?.description?.contextWindowTokens ?? '待确认'}
          </p>
        </section>
      )}
      <button
        onClick={() =>
          window.dispatchEvent(new CustomEvent(MANUAL_MODEL_REFRESH_EVENT, { detail: true }))
        }
      >
        开始手动刷新
      </button>
      <button
        onClick={() =>
          window.dispatchEvent(new CustomEvent(MANUAL_MODEL_REFRESH_EVENT, { detail: false }))
        }
      >
        结束手动刷新
      </button>
      <HarnessDescription
        description={
          models.find((m) => m.id === selected)?.settings?.managedModelCatalog?.description
        }
      />
      <ul>
        {models.map((m) => (
          <li key={m.id}>
            <button onClick={() => setSelected(m.id)}>{m.displayName ?? m.id}</button>
            <span>{m.contextWindowTokens ?? '待确认'}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18n}>
    <ThemeProvider appearance="light">
      <MotionProvider motion={motion}>
        <Harness />
      </MotionProvider>
    </ThemeProvider>
  </I18nextProvider>,
);
