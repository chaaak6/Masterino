/** Normalize OS/browser codes to the case-sensitive resource directory names. */
export const normalizeLocale = (locale: string) => {
  const code = locale.trim().replaceAll('_', '-').toLowerCase();
  const language = code.split('-')[0];
  if (language === 'en') return 'en';
  if (language === 'ar') return 'ar';
  if (language === 'zh' || code === 'cn')
    return code.startsWith('zh-hant') || /^zh-(?:tw|hk|mo)(?:-|$)/.test(code) ? 'zh-TW' : 'zh-CN';
  if (
    !['bg', 'de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'tr', 'vi', 'fa', 'it', 'pl', 'nl'].includes(
      language,
    )
  )
    return 'en';
  const canonical = new Intl.Locale(language).maximize();
  return `${canonical.language}-${canonical.region}`;
};

/**
 * Load translation resources on demand
 */
export const loadResources = async (lng: string, ns: string) => {
  lng = normalizeLocale(lng);
  // All en-* locales fallback to 'en' and use default TypeScript files
  if (lng === 'en' || lng.startsWith('en-')) {
    try {
      const { default: content } = await import(`@/locales/default/${ns}.ts`);

      return content;
    } catch (error) {
      console.error(`[I18n] Unable to load translation file: ${ns}`, error);
      return {};
    }
  }

  try {
    const { default: content } = await import(`@/../../resources/locales/${lng}/${ns}.json`);

    return content;
  } catch (error) {
    console.error(`Unable to load translation file: ${lng} - ${ns}`, error);
    return {};
  }
};
