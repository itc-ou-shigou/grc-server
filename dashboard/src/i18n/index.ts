import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

export const SUPPORTED_LANGUAGES = ['en', 'zh', 'ja', 'ko'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  zh: '简体中文',
  ja: '日本語',
  ko: '한국어',
};

export const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  en: '🇺🇸',
  zh: '🇨🇳',
  ja: '🇯🇵',
  ko: '🇰🇷',
};

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],

    // Namespaces: pre-load common + auth + sidebar; others lazy-loaded on demand
    ns: ['common', 'auth', 'sidebar'],
    defaultNS: 'common',

    // Backend: load JSON from /locales/{lang}/{ns}.json
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    // Language detection priority
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'grc-language',
    },

    // Interpolation
    interpolation: {
      escapeValue: false,
    },

    // React Suspense for lazy loading
    react: {
      useSuspense: true,
    },
  });

// Keep <html lang="..."> in sync with current language (for CJK font-family rules)
i18n.on('languageChanged', (lng: string) => {
  document.documentElement.lang = lng;
});

export default i18n;
