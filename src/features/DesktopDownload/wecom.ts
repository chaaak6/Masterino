type WecomSdk = {
  config: (options: Record<string, unknown>) => void;
  agentConfig: (options: Record<string, unknown>) => void;
  ready: (callback: () => void) => void;
  error: (callback: () => void) => void;
  invoke: (
    method: string,
    args: { url: string },
    callback: (result: { err_msg?: string }) => void,
  ) => void;
};

export const isWecomDesktop = (userAgent: string) =>
  /wxwork/i.test(userAgent) &&
  /Windows|Macintosh|Mac OS X/i.test(userAgent) &&
  !/Android|iPhone|iPad/i.test(userAgent);

let sdkLoading: Promise<WecomSdk> | undefined;
function loadSdk(): Promise<WecomSdk> {
  if (sdkLoading) return sdkLoading;
  sdkLoading = new Promise<WecomSdk>((resolve, reject) => {
    const existing = (window as Window & { wx?: WecomSdk }).wx;
    if (existing && typeof existing.agentConfig === 'function') return resolve(existing);
    const script = document.createElement('script');
    script.src = '/api/desktop/wecom-browser';
    script.onload = () => {
      const sdk = (window as Window & { wx?: WecomSdk }).wx;
      if (sdk) resolve(sdk);
      else reject(new Error('WeCom SDK unavailable'));
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
      sdk.ready(() => {
        if (!active) return;
        sdk.agentConfig({
          corpid: data.corpId,
          agentid: data.agentId,
          timestamp: data.timestamp,
          nonceStr: data.nonceStr,
          signature: data.agentSignature,
          jsApiList: ['openDefaultBrowser'],
          success: () =>
            active &&
            sdk.invoke('openDefaultBrowser', { url: page }, (result) =>
              finish(result.err_msg === 'openDefaultBrowser:ok' ? undefined : new Error(page)),
            ),
          fail: () => finish(new Error(page)),
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
