'use client';

import { ArrowUpRight, Check, Download, Laptop, Monitor } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

import english from '../../../locales/en-US/common.json';
import vietnameseMessages from '../../../locales/vi-VN/common.json';
import chineseMessages from '../../../locales/zh-CN/common.json';
import styles from './DownloadPage.module.css';
import { downloadDesktop } from './index';
import { detectDownloadTarget, type DetectedTarget, type DownloadTarget } from './platform';
import { isWecomDesktop, openWecomDownloadPage } from './wecom';

const choices: DownloadTarget[] = ['win32/x64', 'darwin/arm64', 'darwin/x64'];

const vietnamese = { ...english, ...vietnameseMessages };

const getMessages = (language: string) =>
  language.startsWith('zh') ? chineseMessages : language.startsWith('vi') ? vietnamese : english;

const getInstaller = (target: DownloadTarget, messages: ReturnType<typeof getMessages>) => {
  if (target === 'win32/x64') return { chip: 'x64', platform: 'Windows' };
  return {
    chip: target === 'darwin/arm64' ? messages['desktopDownload.appleSilicon'] : 'Intel',
    platform: 'macOS',
  };
};

export default function DownloadPage() {
  const started = useRef(false);
  const requesting = useRef(false);
  const manuallySelected = useRef(false);
  const [download, setDownload] = useState<{ target: DownloadTarget; version: string }>();
  const [detected, setDetected] = useState<DetectedTarget>();
  const [pendingTarget, setPendingTarget] = useState<DownloadTarget>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState('en');
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState(false);
  const [browserFailed, setBrowserFailed] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const messages = getMessages(language);

  const start = useCallback(async (target: DownloadTarget) => {
    if (requesting.current) return;
    requesting.current = true;
    setBusy(true);
    setPendingTarget(target);
    setFailed(false);
    try {
      const version = await downloadDesktop(target);
      if (!version) throw new Error('Desktop download unavailable');
      setDownload({ target, version });
    } catch {
      setFailed(true);
    } finally {
      requesting.current = false;
      setPendingTarget(undefined);
      setBusy(false);
    }
  }, []);

  const openExternalBrowser = async () => {
    if (requesting.current) return;
    requesting.current = true;
    setBusy(true);
    setBrowserFailed(false);
    try {
      await openWecomDownloadPage();
    } catch {
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
    const inWecom = isWecomDesktop(navigator.userAgent, navigator.maxTouchPoints);
    const manualRequested = new URLSearchParams(window.location.search).get('manual') === '1';
    setEmbedded(inWecom);
    setManual(manualRequested);
    setReady(true);
    if (inWecom) return;

    void detectDownloadTarget(navigator).then((target) => {
      setDetected(target);
      if (
        !manualRequested &&
        !manuallySelected.current &&
        target !== 'mac' &&
        target !== 'unsupported'
      )
        void start(target);
    });
  }, [start]);

  const downloadTarget = pendingTarget ?? download?.target;
  const installer = downloadTarget && getInstaller(downloadTarget, messages);
  const detectedDevice =
    detected === 'mac'
      ? messages['desktopDownload.macChipUnknown']
      : detected === 'darwin/arm64'
        ? `macOS · ${messages['desktopDownload.appleSilicon']}`
        : detected === 'darwin/x64'
          ? 'macOS · Intel'
          : detected === 'win32/x64'
            ? 'Windows'
            : undefined;

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Image
              unoptimized
              alt=""
              height={44}
              src="/brand/masterlion/logo-static.png"
              width={44}
            />
            <span>Masterino</span>
          </div>
          <h1>{messages.getDesktopApp}</h1>
        </header>

        <div className={styles.feedback} role="status">
          {detectedDevice && (
            <p className={styles.device}>
              <Laptop aria-hidden size={17} />
              {messages['desktopDownload.detectedDevice']} · <strong>{detectedDevice}</strong>
            </p>
          )}
          {installer && !failed && (
            <div className={styles.download} data-pending={!!pendingTarget}>
              <span className={styles.downloadIcon}>
                {pendingTarget ? (
                  <Download aria-hidden size={18} />
                ) : (
                  <Check aria-hidden size={18} />
                )}
              </span>
              <div>
                <p>
                  {
                    messages[
                      pendingTarget ? 'desktopDownload.preparing' : 'desktopDownload.started'
                    ]
                  }
                </p>
                <strong>
                  {installer.platform} · {installer.chip}
                </strong>
              </div>
              {!pendingTarget && download && (
                <span className={styles.version}>v{download.version}</span>
              )}
            </div>
          )}
          {failed && <p className={styles.error}>{messages['desktopDownload.failed']}</p>}
          {browserFailed && (
            <p className={styles.error}>
              {messages['desktopDownload.browserFailed']}{' '}
              <a href="/download?manual=1" rel="noreferrer" target="_blank">
                {new URL('/download?manual=1', window.location.origin).href}
              </a>
            </p>
          )}
          {detected === 'unsupported' && <p>{messages['desktopDownload.unsupported']}</p>}
        </div>

        {ready && embedded && (
          <button
            className={styles.browser}
            disabled={busy}
            type="button"
            onClick={openExternalBrowser}
          >
            {messages['desktopDownload.openBrowser']}
            <ArrowUpRight aria-hidden size={18} />
          </button>
        )}

        {ready && (!embedded || manual) && (
          <section aria-labelledby="installers">
            <h2 id="installers">{messages['desktopDownload.selectInstaller']}</h2>
            <div className={styles.options}>
              {choices.map((target) => {
                const { chip, platform } = getInstaller(target, messages);
                const Icon = target === 'win32/x64' ? Monitor : Laptop;
                return (
                  <button
                    className={styles.option}
                    disabled={busy}
                    key={target}
                    type="button"
                    onClick={() => {
                      manuallySelected.current = true;
                      void start(target);
                    }}
                  >
                    <span className={styles.optionIcon}>
                      <Icon aria-hidden size={21} />
                    </span>
                    <span className={styles.optionLabel}>
                      <strong>{platform}</strong>
                      <span>{chip}</span>
                    </span>
                    <Download aria-hidden className={styles.optionDownload} size={18} />
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
