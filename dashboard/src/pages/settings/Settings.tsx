import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, LANGUAGE_FLAGS } from '../../i18n';
import type { SupportedLanguage } from '../../i18n';

export function Settings() {
  const { t, i18n } = useTranslation('settings');

  const handleLanguageChange = async (lang: SupportedLanguage) => {
    // 1. Change i18next language (updates all UI text instantly)
    await i18n.changeLanguage(lang);

    // 2. Persist to server (if user is logged in)
    try {
      const token = localStorage.getItem('grc_admin_token');
      if (token) {
        await fetch('/api/v1/admin/auth/me/language', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ language: lang }),
        });
      }
    } catch {
      // Server sync failure is non-critical; localStorage is the primary source
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="page-subtitle">{t('subtitle')}</p>
        </div>
      </div>

      {/* Language Section */}
      <div className="settings-section">
        <h2 className="settings-section-title">{t('language.title')}</h2>
        <p className="settings-section-desc">{t('language.description')}</p>

        <div className="language-grid">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang}
              className={`language-card${i18n.language === lang ? ' active' : ''}`}
              onClick={() => handleLanguageChange(lang)}
            >
              <span className="language-flag">{LANGUAGE_FLAGS[lang]}</span>
              <span className="language-label">{LANGUAGE_LABELS[lang]}</span>
              {i18n.language === lang && (
                <span className="language-check">✓</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
