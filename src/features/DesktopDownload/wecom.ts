type WecomSdk = {
  config: (options: Record<string, unknown>) => void;
  ready: (callback: () => void) => void;
  error: (callback: () => void) => void;
  invoke?: (
    method: string,
    args: { url: string },
    callback: (result: { err_msg?: string; errMsg?: string }) => void,
  ) => void;
};

export const isWecomDesktop = (userAgent: string, maxTouchPoints = 0) =>
  /wxwork/i.test(userAgent) &&
  /Windows|Macintosh|Mac OS X/i.test(userAgent) &&
  !/Android|iPhone|iPad|Mobile/i.test(userAgent) &&
  !(/Macintosh/i.test(userAgent) && maxTouchPoints > 1);

let sdkLoading: Promise<WecomSdk> | undefined;
const hasConfigApi = (sdk?: WecomSdk): sdk is WecomSdk =>
  typeof sdk?.config === 'function' &&
  typeof sdk.ready === 'function' &&
  typeof sdk.error === 'function';

function loadSdk(): Promise<WecomSdk> {
  if (sdkLoading) return sdkLoading;
  sdkLoading = new Promise<WecomSdk>((resolve, reject) => {
    const sdkWindow = window as Window & { wx?: WecomSdk };
    if (hasConfigApi(sdkWindow.wx)) return resolve(sdkWindow.wx);
    const script = document.createElement('script');
    script.src = '/api/desktop/wecom-browser?v=2';
    script.onload = () => {
      if (hasConfigApi(sdkWindow.wx)) resolve(sdkWindow.wx);
      else {
        script.remove();
        reject(new Error('WeCom SDK unavailable'));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('WeCom SDK unavailable'));
    };
    document.head.append(script);
  }).catch((error) => {
    sdkLoading = undefined;
    throw error;
  });
  return sdkLoading;
}

export async function openWecomDownloadPage() {
  const page = new URL('/download', window.location.origin).href;
  await new Promise<void>((resolve, reject) => {
    let active = true;
    const timer = setTimeout(() => finish(new Error(page)), 15000);
    const finish = (error?: Error) => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    void (async () => {
      const [sdk, response] = await Promise.all([
        loadSdk(),
        fetch('/api/desktop/wecom-browser', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: window.location.href.split('#')[0] }),
          signal: AbortSignal.timeout(10000),
        }),
      ]);
      if (!response.ok) throw new Error(page);
      const data = await response.json();
      if (!active) return;
      sdk.error(() => finish(new Error(page)));
      // The legacy SDK installs invoke during config({ beta: true }).
      sdk.ready(() => {
        queueMicrotask(() => {
          if (!active) return;
          try {
            if (typeof sdk.invoke !== 'function') return finish(new Error(page));
            sdk.invoke('openDefaultBrowser', { url: page }, (result) =>
              finish(
                (result.err_msg || result.errMsg) === 'openDefaultBrowser:ok'
                  ? undefined
                  : new Error(page),
              ),
            );
          } catch {
            finish(new Error(page));
          }
        });
      });
      sdk.config({
        beta: true,
        debug: false,
        appId: data.corpId,
        timestamp: data.timestamp,
        nonceStr: data.nonceStr,
        signature: data.signature,
        jsApiList: ['openDefaultBrowser'],
      });
    })().catch(() => finish(new Error(page)));
  });
}
