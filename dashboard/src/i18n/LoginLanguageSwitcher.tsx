import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, LANGUAGE_FLAGS } from './index';
import type { SupportedLanguage } from './index';

/**
 * Compact language switcher for the login page (pre-authentication).
 * Displays as: 🌐 EN ▼  (globe icon + language code + dropdown arrow)
 * Positioned in the top-right corner of the login card header.
 */
export function LoginLanguageSwitcher() {
  const { i18n } = useTranslation();

  const handleChange = (lang: SupportedLanguage) => {
    i18n.changeLanguage(lang);
  };

  return (
    <div className="login-language-switcher">
      <span className="login-lang-icon">🌐</span>
      <select
        value={i18n.language}
        onChange={(e) => handleChange(e.target.value as SupportedLanguage)}
        className="login-lang-select"
        aria-label="Select language"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {LANGUAGE_FLAGS[lang]} {LANGUAGE_LABELS[lang]}
          </option>
        ))}
      </select>
    </div>
  );
}
