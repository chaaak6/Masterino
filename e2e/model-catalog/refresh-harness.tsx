import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { ThemeProvider, MotionProvider } from '@lobehub/ui';
import { motion } from 'motion/react';
import i18n from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import components from '../../locales/zh-CN/components.json';
import ManagedModelDescriptionContent from '../../src/features/ModelSwitchPanel/components/ManagedModelDescriptionContent';
i18n
  .use(initReactI18next)
  .init({
    lng: 'zh-CN',
    keySeparator: false,
    resources: { 'zh-CN': { components } },
    interpolation: { escapeValue: false },
  });
import {
  SilentModelRefreshController,
  MANUAL_MODEL_REFRESH_EVENT,
} from '../../src/features/SilentModelRefresh/controller';

const client = createTRPCClient<any>({
  links: [httpBatchLink({ url: '/trpc/lambda', transformer: superjson })],
});
function Harness() {
  const [models, setModels] = useState<any[]>([{ id: 'old', displayName: '原有模型' }]);
  const [revision, setRevision] = useState('');
  const [checks, setChecks] = useState(0);
  const [selected, setSelected] = useState('bdd-chat');
  const [running, setRunning] = useState('');
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
      <ManagedModelDescriptionContent
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
