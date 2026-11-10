'use client';

import { Button } from '@lobehub/ui/base-ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import english from '../../../locales/en-US/common.json';
import vietnameseMessages from '../../../locales/vi-VN/common.json';
import chineseMessages from '../../../locales/zh-CN/common.json';
import { downloadDesktop } from './index';
import { detectDownloadTarget, type DownloadTarget } from './platform';
import { isWecomDesktop, openWecomDownloadPage } from './wecom';

const choices: { target: DownloadTarget; label: string }[] = [
  { target: 'win32/x64', label: 'Windows x64' },
  { target: 'darwin/arm64', label: 'macOS · Apple Silicon (M1 / M2 / M3 / M4 / M5)' },
  { target: 'darwin/x64', label: 'macOS · Intel' },
];

const getMessages = (language: string) =>
  language.startsWith('zh')
    ? chineseMessages
    : language.startsWith('vi')
      ? vietnameseMessages
      : english;
const browserMessages = () => getMessages(navigator.language);

export default function DownloadPage() {
  const started = useRef(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState('');
  const [language, setLanguage] = useState('en');
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState(false);
  const [browserFailed, setBrowserFailed] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const requesting = useRef(false);
  const manuallySelected = useRef(false);
  const messages = getMessages(language);
  const start = useCallback(async (target: DownloadTarget) => {
    if (requesting.current) return;
    requesting.current = true;
    setBusy(true);
    try {
      const downloadedVersion = await downloadDesktop(target);
      if (!downloadedVersion) throw new Error('Desktop download unavailable');
      setVersion(downloadedVersion);
      setStatus(browserMessages()['desktopDownload.started']);
    } catch {
      setStatus(browserMessages()['desktopDownload.failed']);
    } finally {
      requesting.current = false;
      setBusy(false);
    }
  }, []);
  const openExternalBrowser = async () => {
    if (requesting.current) return;
    requesting.current = true;
    setBusy(true);
    try {
      await openWecomDownloadPage();
    } catch {
      setStatus(browserMessages()['desktopDownload.browserFailed']);
      setBrowserFailed(true);
      setManual(true);
    } finally {
      requesting.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setLanguage(navigator.language);
    setReady(true);
    setEmbedded(isWecomDesktop(navigator.userAgent, navigator.maxTouchPoints));
    const manualRequested = new URLSearchParams(window.location.search).get('manual') === '1';
    setManual(manualRequested);
    void (async () => {
      if (isWecomDesktop(navigator.userAgent, navigator.maxTouchPoints)) {
        setStatus(browserMessages()['desktopDownload.openBrowser']);
        return;
      }
      if (manualRequested) return;
      const target = await detectDownloadTarget(navigator);
      const text = browserMessages();
      if (manuallySelected.current) return;
      if (target === 'mac') setStatus(text['desktopDownload.chooseMac']);
      else if (target === 'unsupported') setStatus(text['desktopDownload.unsupported']);
      else await start(target);
    })();
  }, [start]);
  return (
    <main
      style={{
        margin: '64px auto',
        maxWidth: 520,
        padding: 24,
        fontFamily: 'system-ui',
        lineHeight: 1.6,
      }}
    >
      <h1>Masterino</h1>
      <p role="status">
        {status} {version && `· ${version}`}
      </p>
      {browserFailed && (
        <a href="/download?manual=1" rel="noreferrer" target="_blank">
          {new URL('/download?manual=1', window.location.origin).href}
        </a>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        {ready &&
          (!embedded || manual) &&
          choices.map(({ target, label }) => (
            <Button
              disabled={busy}
              key={target}
              style={{ padding: 14, cursor: 'pointer', font: 'inherit' }}
              onClick={() => {
                manuallySelected.current = true;
                void start(target);
              }}
            >
              {target === 'darwin/arm64'
                ? `macOS · ${messages['desktopDownload.appleSilicon']}`
                : label}
            </Button>
          ))}
        {ready && embedded && (
          <Button
            disabled={busy}
            onClick={() => {
              void openExternalBrowser();
            }}
          >
            {messages['desktopDownload.openBrowser']}
          </Button>
        )}
      </div>
    </main>
  );
}
