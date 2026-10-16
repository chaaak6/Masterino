import { defaultUrlTransform } from 'react-markdown';

/** Only PNG image sources use this capability; main still validates its exact file/token/TTL. */
export const transformPreviewUrl = (url: string, key: string, tag: string, desktop: boolean) => {
  if (desktop && key === 'src' && tag === 'img' && url.startsWith('localfile://file/')) {
    try {
      const parsed = new URL(url);
      const token = parsed.searchParams.get('token') ?? '';
      if (
        parsed.hostname === 'file' &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        !parsed.hash &&
        parsed.pathname.endsWith('.png') &&
        parsed.searchParams.size === 1 &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(token)
      )
        return url;
    } catch {
      /* An invalid capability URL follows the normal sanitizer. */
    }
  }
  return defaultUrlTransform(url);
};
