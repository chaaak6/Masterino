export type DownloadTarget = 'win32/x64' | 'darwin/arm64' | 'darwin/x64';
export type DetectedTarget = DownloadTarget | 'mac' | 'unsupported';

type BrowserInfo = {
  maxTouchPoints?: number;
  userAgent: string;
  userAgentData?: {
    getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }>;
  };
};

export async function detectDownloadTarget(browser: BrowserInfo): Promise<DetectedTarget> {
  const ua = browser.userAgent;
  if (
    /Android|iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && (browser.maxTouchPoints ?? 0) > 1)
  )
    return 'unsupported';
  if (/Windows/i.test(ua)) return 'win32/x64';
  if (!/Macintosh|Mac OS X/i.test(ua)) return 'unsupported';
  try {
    const hints = await Promise.race([
      browser.userAgentData?.getHighEntropyValues(['architecture', 'bitness']),
      new Promise<undefined>((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (hints?.architecture === 'arm') return 'darwin/arm64';
    if (hints?.architecture === 'x86' && hints.bitness === '64') return 'darwin/x64';
  } catch {
    // Safari, Firefox and restricted Client Hints require an explicit choice.
  }
  return 'mac';
}
