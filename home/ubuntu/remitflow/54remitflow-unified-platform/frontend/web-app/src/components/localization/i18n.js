import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    debug: true,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    resources: {
      en: {
        translation: {
          greeting: 'Hello, Welcome!',
          // Add more translations here
        }
      },
      es: {
        translation: {
          greeting: 'Hola, ¡Bienvenido!',
          // Add more translations here
        }
      }
    }
  });

export default i18n;
