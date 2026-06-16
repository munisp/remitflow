import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import pt from "./locales/pt.json";
import yo from "./locales/yo.json";
import ig from "./locales/ig.json";
import ha from "./locales/ha.json";
import pcm from "./locales/pcm.json";
import sw from "./locales/sw.json";
import am from "./locales/am.json";
import ak from "./locales/ak.json";
import wo from "./locales/wo.json";
import ar from "./locales/ar.json";
import ff from "./locales/ff.json";

/**
 * Supported languages — 13 total covering:
 * - Global: English, Spanish, French, Portuguese, Arabic
 * - Nigeria: Yoruba, Igbo, Hausa, Nigerian Pidgin
 * - East Africa: Swahili (Kenya, Tanzania, Uganda)
 * - Ethiopia: Amharic
 * - Ghana: Twi (Akan)
 * - Senegal/West Africa: Wolof
 * - West Africa: Fulfulde (Fula/Pulaar)
 */
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      pt: { translation: pt },
      yo: { translation: yo },
      ig: { translation: ig },
      ha: { translation: ha },
      pcm: { translation: pcm },
      sw: { translation: sw },
      am: { translation: am },
      ak: { translation: ak },
      wo: { translation: wo },
      ar: { translation: ar },
      ff: { translation: ff },
    },
    fallbackLng: "en",
    supportedLngs: [
      "en", "es", "fr", "pt",
      "yo", "ig", "ha", "pcm",
      "sw", "am", "ak", "wo", "ar", "ff",
    ],
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupLocalStorage: "remitflow_lang",
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export default i18n;

/** Language metadata for the language switcher UI */
export const LANGUAGE_OPTIONS = [
  { code: "en", label: "English", nativeLabel: "English", flag: "🇬🇧" },
  { code: "es", label: "Spanish", nativeLabel: "Español", flag: "🇪🇸" },
  { code: "fr", label: "French", nativeLabel: "Français", flag: "🇫🇷" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português", flag: "🇧🇷" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", flag: "🇸🇦", rtl: true },
  { code: "yo", label: "Yoruba", nativeLabel: "Yorùbá", flag: "🇳🇬" },
  { code: "ig", label: "Igbo", nativeLabel: "Igbo", flag: "🇳🇬" },
  { code: "ha", label: "Hausa", nativeLabel: "Hausa", flag: "🇳🇬" },
  { code: "pcm", label: "Pidgin", nativeLabel: "Naijá Pidgin", flag: "🇳🇬" },
  { code: "sw", label: "Swahili", nativeLabel: "Kiswahili", flag: "🇰🇪" },
  { code: "am", label: "Amharic", nativeLabel: "አማርኛ", flag: "🇪🇹" },
  { code: "ak", label: "Twi", nativeLabel: "Twi (Akan)", flag: "🇬🇭" },
  { code: "wo", label: "Wolof", nativeLabel: "Wolof", flag: "🇸🇳" },
  { code: "ff", label: "Fulfulde", nativeLabel: "Fulfulde", flag: "🇳🇪" },
] as const;
