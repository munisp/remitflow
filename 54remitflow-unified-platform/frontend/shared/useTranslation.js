/**
 * useTranslation Hook
 * Provides multi-lingual support across all frontend applications
 * Supports: English, Yoruba, Igbo, Hausa, Nigerian Pidgin
 */

import { useState, useEffect, createContext, useContext } from 'react';

// Translation Context
const TranslationContext = createContext();

// Multi-lingual Integration Service URL
const TRANSLATION_API = process.env.REACT_APP_TRANSLATION_API || 'http://localhost:8097';

// Language options
export const LANGUAGES = {
  en: { name: 'English', flag: '🇬🇧' },
  yo: { name: 'Yoruba', flag: '🇳🇬' },
  ig: { name: 'Igbo', flag: '🇳🇬' },
  ha: { name: 'Hausa', flag: '🇳🇬' },
  pcm: { name: 'Pidgin', flag: '🇳🇬' }
};

/**
 * Translation Provider Component
 * Wrap your app with this to enable translations
 */
export function TranslationProvider({ children, defaultLanguage = 'en', module }) {
  const [language, setLanguage] = useState(
    localStorage.getItem('preferred_language') || defaultLanguage
  );
  const [translations, setTranslations] = useState({});
  const [loading, setLoading] = useState(true);

  // Load translations when language or module changes
  useEffect(() => {
    loadTranslations();
  }, [language, module]);

  const loadTranslations = async () => {
    try {
      setLoading(true);
      
      // Load all translations for the current language
      const response = await fetch(
        `${TRANSLATION_API}/translations?language=${language}`
      );
      
      if (response.ok) {
        const data = await response.json();
        setTranslations(data.modules);
      }
    } catch (error) {
      console.error('Failed to load translations:', error);
    } finally {
      setLoading(false);
    }
  };

  const changeLanguage = (newLanguage) => {
    setLanguage(newLanguage);
    localStorage.setItem('preferred_language', newLanguage);
  };

  const t = (module, key, fallback = key) => {
    if (translations[module] && translations[module][key]) {
      return translations[module][key];
    }
    return fallback;
  };

  const value = {
    language,
    changeLanguage,
    t,
    loading,
    languages: LANGUAGES
  };

  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  );
}

/**
 * useTranslation Hook
 * Use this in your components to access translations
 * 
 * @param {string} module - Module name (remittance, ecommerce, inventory, common, messages)
 * @returns {object} - Translation functions and state
 * 
 * @example
 * const { t, language, changeLanguage } = useTranslation('remittance');
 * 
 * return (
 *   <div>
 *     <h1>{t('dashboard')}</h1>
 *     <button onClick={() => changeLanguage('yo')}>Switch to Yoruba</button>
 *   </div>
 * );
 */
export function useTranslation(module = 'common') {
  const context = useContext(TranslationContext);
  
  if (!context) {
    throw new Error('useTranslation must be used within TranslationProvider');
  }

  const { t: translate, ...rest } = context;

  // Module-specific translation function
  const t = (key, fallback) => translate(module, key, fallback);

  return {
    t,
    ...rest
  };
}

/**
 * Language Selector Component
 * Dropdown to switch between languages
 */
export function LanguageSelector({ className = '' }) {
  const { language, changeLanguage, languages } = useTranslation();

  return (
    <select
      value={language}
      onChange={(e) => changeLanguage(e.target.value)}
      className={`language-selector ${className}`}
      aria-label="Select Language"
    >
      {Object.entries(languages).map(([code, { name, flag }]) => (
        <option key={code} value={code}>
          {flag} {name}
        </option>
      ))}
    </select>
  );
}

/**
 * Translate Component
 * Component-based translation (alternative to hook)
 * 
 * @example
 * <Translate module="remittance" text="dashboard" />
 */
export function Translate({ module, text, fallback }) {
  const { t } = useTranslation(module);
  return <>{t(text, fallback)}</>;
}

export default useTranslation;

