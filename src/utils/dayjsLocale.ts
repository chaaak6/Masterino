import { normalizeLocale } from '@/locales/localeCodes';

interface DayjsLocaleModule {
  default: ILocale;
}

type DayjsLocaleLoader = () => DayjsLocaleModule | Promise<DayjsLocaleModule>;

export type DayjsLocaleGlobEntry = DayjsLocaleLoader | DayjsLocaleModule;

export const loadDayjsLocaleModule = async (
  entry: DayjsLocaleGlobEntry,
): Promise<DayjsLocaleModule> => (typeof entry === 'function' ? entry() : entry);

export const normalizeDayjsLocale = (lang: string): string => {
  const locale = normalizeLocale(lang).toLowerCase();
  return ['zh-cn', 'zh-tw', 'pt-br'].includes(locale) ? locale : locale.split('-')[0];
};
