export const locales = [
  'ar',
  'bg-BG',
  'de-DE',
  'en-US',
  'es-ES',
  'fr-FR',
  'ja-JP',
  'ko-KR',
  'pt-BR',
  'ru-RU',
  'tr-TR',
  'zh-CN',
  'zh-TW',
  'vi-VN',
  'fa-IR',
  'it-IT',
  'pl-PL',
  'nl-NL',
] as const;

export type Locales = (typeof locales)[number];

/** Canonical application locales, shared by browser and Electron. */
export const normalizeLocale = (locale?: string): Locales => {
  const code = locale?.trim().replaceAll('_', '-').toLowerCase();
  if (!code) return 'en-US';
  const exact = locales.find((value) => value.toLowerCase() === code);
  if (exact) return exact;
  if (code === 'cn') return 'zh-CN';
  if (code.startsWith('zh-hant') || /^zh-(?:tw|hk|mo)(?:-|$)/.test(code)) return 'zh-TW';
  const base = code.split('-')[0];
  return locales.find((value) => value.toLowerCase().split('-')[0] === base) ?? 'en-US';
};
