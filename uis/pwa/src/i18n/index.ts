import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// PERF (wave14): only the default locale (en) is bundled eagerly. The other
// four locales are dynamic-imported on selection, so first paint no longer
// pays for ~4 unused translation JSON blobs. When a locale chunk finishes,
// addResourceBundle fires the store 'added' event, which react-i18next is
// subscribed to by default — components re-render with the new strings.
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'ha', label: 'Hausa' },
  { code: 'yo', label: 'Yorùbá' },
  { code: 'pcm', label: 'Pidgin' },
] as const;

type LocaleCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

const localeLoaders: Record<Exclude<LocaleCode, 'en'>, () => Promise<{ default: Record<string, unknown> }>> = {
  fr: () => import('./locales/fr.json'),
  ha: () => import('./locales/ha.json'),
  yo: () => import('./locales/yo.json'),
  pcm: () => import('./locales/pcm.json'),
};

const loadedLocales = new Set<string>(['en']);

async function loadLocale(lng: string): Promise<void> {
  const base = lng.split('-')[0];
  if (loadedLocales.has(base)) return;
  const loader = localeLoaders[base as Exclude<LocaleCode, 'en'>];
  if (!loader) return; // unsupported locale — fallbackLng 'en' applies
  try {
    const mod = await loader();
    i18n.addResourceBundle(base, 'translation', mod.default, true, true);
    loadedLocales.add(base);
  } catch (error) {
    // Fail closed to the English fallback: a locale chunk that cannot be
    // fetched (e.g. offline first visit) must not break rendering.
    console.error(`i18n: failed to load locale '${base}', using fallback`, error);
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'app_language',
    },
  });

// Load whatever language the detector resolved at boot (covers returning
// users with a stored preference) and every subsequent switch.
if (i18n.language) {
  void loadLocale(i18n.language);
}
i18n.on('languageChanged', (lng) => {
  void loadLocale(lng);
});

export default i18n;
