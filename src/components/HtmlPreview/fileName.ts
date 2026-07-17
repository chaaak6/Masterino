export const extractHtmlTitle = (content: string): string | undefined => {
  const match = content.match(/<title>([\S\s]*?)<\/title>/i);
  return match?.[1].trim() || undefined;
};

export const sanitizeHtmlFileName = (name: string): string =>
  name
    .replaceAll(/["*/:<>?\\|]/g, '-')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

export const getHtmlFileName = (content: string, fallbackBase: string): string => {
  const title = extractHtmlTitle(content);
  const sanitizedTitle = title ? sanitizeHtmlFileName(title) : '';
  const sanitizedFallback = sanitizeHtmlFileName(fallbackBase) || 'html-artifact';
  const base = sanitizedTitle || sanitizedFallback;

  return `${base.replace(/\.html?$/i, '')}.html`;
};
