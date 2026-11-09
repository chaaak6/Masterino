'use client';

import { Button } from '@lobehub/ui';
import { useEffect, useRef, useState } from 'react';

import english from '../../../locales/en-US/common.json';
import chineseMessages from '../../../locales/zh-CN/common.json';
import { downloadDesktop } from './index';
import { detectDownloadTarget, type DownloadTarget } from './platform';
import { isWecomDesktop, openWecomDownloadPage } from './wecom';

const choices: { target: DownloadTarget; label: string }[] = [
  { target: 'win32/x64', label: 'Windows x64' },
  { target: 'darwin/arm64', label: 'macOS · Apple Silicon (M1 / M2 / M3 / M4 / M5)' },
  { target: 'darwin/x64', label: 'macOS · Intel' },
];

export default function DownloadPage() {
  const started = useRef(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState('');
  const [chinese, setChinese] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const requesting = useRef(false);
  const manuallySelected = useRef(false);
  const messages = chinese ? chineseMessages : english;
  const start = async (target: DownloadTarget) => {
    if (requesting.current) return;
    requesting.current = true;
    setBusy(true);
    try {
      const downloadedVersion = await downloadDesktop(target);
      if (!downloadedVersion) return;
      setVersion(downloadedVersion);
      setStatus(
        (navigator.language.startsWith('zh') ? chineseMessages : english)[
          'desktopDownload.started'
        ],
      );
    } catch {
      setStatus(
        (navigator.language.startsWith('zh') ? chineseMessages : english)['desktopDownload.failed'],
      );
    } finally {
      requesting.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setChinese(navigator.language.startsWith('zh'));
    setEmbedded(isWecomDesktop(navigator.userAgent));
    void (async () => {
      if (isWecomDesktop(navigator.userAgent)) {
        setStatus(
          (navigator.language.startsWith('zh') ? chineseMessages : english)[
            'desktopDownload.openBrowser'
          ],
        );
        return;
      }
      const target = await detectDownloadTarget(navigator);
      const text = navigator.language.startsWith('zh') ? chineseMessages : english;
      if (manuallySelected.current) return;
      if (target === 'mac') setStatus(text['desktopDownload.chooseMac']);
      else if (target === 'unsupported') setStatus(text['desktopDownload.unsupported']);
      else await start(target);
    })();
  }, []);
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
      <div style={{ display: 'grid', gap: 12 }}>
        {!embedded &&
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
              {label}
            </Button>
          ))}
        {embedded && (
          <Button
            disabled={busy}
            onClick={() => {
              void openWecomDownloadPage().catch(() => setStatus(window.location.href));
            }}
          >
            {messages['desktopDownload.openBrowser']}
          </Button>
        )}
      </div>
    </main>
  );
}
