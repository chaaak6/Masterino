import { Button, Flexbox } from '@lobehub/ui';
import { createModal, useModalContext } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isProductFeatureDisabled } from '@/config/productFeatures';

import { detectDownloadTarget, type DownloadTarget } from './platform';

type Release = { artifacts: { arch: string; platform: string; url: string }[]; version: string };

export async function downloadDesktop(target: DownloadTarget) {
  if (isProductFeatureDisabled('desktopApp')) return;
  const response = await fetch('/api/desktop/download', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Download unavailable');
  const release: Release = await response.json();
  const artifact = release.artifacts.find((item) => `${item.platform}/${item.arch}` === target);
  if (!artifact) throw new Error('Installer unavailable');
  // Direct navigation avoids popup blockers after the asynchronous manifest request.
  window.location.assign(artifact.url);
}

function DownloadChoice({ target }: { target: DownloadTarget | 'mac' | 'unsupported' }) {
  const { close } = useModalContext();
  const { t } = useTranslation('common');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(target !== 'mac' && target !== 'unsupported');
  const choose = async (choice: DownloadTarget) => {
    setLoading(true);
    setError(false);
    try {
      await downloadDesktop(choice);
      close();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Flexbox gap={12}>
      {error && <span role="alert">{t('desktopDownload.failed')}</span>}
      {target === 'unsupported' ? (
        <span>{t('desktopDownload.unsupported')}</span>
      ) : target === 'mac' ? (
        <Flexbox horizontal gap={12}>
          <Button disabled={loading} onClick={() => void choose('darwin/arm64')}>
            {t('desktopDownload.appleSilicon')}
          </Button>
          <Button disabled={loading} onClick={() => void choose('darwin/x64')}>
            Intel
          </Button>
        </Flexbox>
      ) : (
        <Button loading={loading} onClick={() => void choose(target)}>
          {t('retry')}
        </Button>
      )}
    </Flexbox>
  );
}

export function useDesktopDownload() {
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const disabled = isProductFeatureDisabled('desktopApp');
  const download = async () => {
    if (busy.current || isProductFeatureDisabled('desktopApp')) return;
    busy.current = true;
    setLoading(true);
    let target: Awaited<ReturnType<typeof detectDownloadTarget>> = 'unsupported';
    let showChoice = false;
    try {
      target = await detectDownloadTarget(navigator);
      if (target === 'mac' || target === 'unsupported') showChoice = true;
      else await downloadDesktop(target);
    } catch {
      showChoice = true;
    } finally {
      busy.current = false;
      setLoading(false);
    }
    if (showChoice)
      createModal({
        content: <DownloadChoice target={target} />,
        footer: null,
        title: t(target === 'mac' ? 'desktopDownload.chooseMac' : 'getDesktopApp', {
          ns: 'common',
        }),
        width: 420,
      });
  };
  return { disabled, download, loading };
}
