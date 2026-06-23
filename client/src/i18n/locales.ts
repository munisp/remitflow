/**
 * i18n Locales — Platform Hardening
 *
 * Supports: English, Yoruba, Igbo, Hausa, French, Swahili, Twi
 * Priority African languages for RemitFlow's target markets
 */

export type SupportedLocale = "en" | "yo" | "ig" | "ha" | "fr" | "sw" | "tw";

export const SUPPORTED_LOCALES: Array<{ code: SupportedLocale; name: string; nativeName: string; flag: string }> = [
  { code: "en", name: "English", nativeName: "English", flag: "GB" },
  { code: "yo", name: "Yoruba", nativeName: "Yoruba", flag: "NG" },
  { code: "ig", name: "Igbo", nativeName: "Igbo", flag: "NG" },
  { code: "ha", name: "Hausa", nativeName: "Hausa", flag: "NG" },
  { code: "fr", name: "French", nativeName: "Francais", flag: "FR" },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili", flag: "KE" },
  { code: "tw", name: "Twi", nativeName: "Twi", flag: "GH" },
];

export type TranslationKey =
  | "common.send"
  | "common.receive"
  | "common.balance"
  | "common.loading"
  | "common.error"
  | "common.success"
  | "common.cancel"
  | "common.confirm"
  | "common.amount"
  | "common.currency"
  | "common.offline"
  | "stablecoin.buy"
  | "stablecoin.sell"
  | "stablecoin.bridge"
  | "stablecoin.yield"
  | "stablecoin.dca"
  | "stablecoin.card"
  | "stablecoin.p2p"
  | "stablecoin.depeg_alert"
  | "stablecoin.saga_protection"
  | "kyc.verify_identity"
  | "kyc.document_expired"
  | "kyc.upload_document"
  | "kyc.liveness_check"
  | "kyc.nfc_scan"
  | "fund.transfer"
  | "fund.pending"
  | "fund.completed"
  | "fund.failed"
  | "security.maker_checker"
  | "security.approval_required";

type Translations = Record<TranslationKey, string>;

export const translations: Record<SupportedLocale, Translations> = {
  en: {
    "common.send": "Send",
    "common.receive": "Receive",
    "common.balance": "Balance",
    "common.loading": "Loading...",
    "common.error": "Error",
    "common.success": "Success",
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.amount": "Amount",
    "common.currency": "Currency",
    "common.offline": "You are offline",
    "stablecoin.buy": "Buy Stablecoin",
    "stablecoin.sell": "Sell Stablecoin",
    "stablecoin.bridge": "Bridge",
    "stablecoin.yield": "Earn Yield",
    "stablecoin.dca": "DCA Plan",
    "stablecoin.card": "Virtual Card",
    "stablecoin.p2p": "P2P Transfer",
    "stablecoin.depeg_alert": "De-Peg Alert",
    "stablecoin.saga_protection": "Protected by Temporal saga",
    "kyc.verify_identity": "Verify Identity",
    "kyc.document_expired": "Document expired",
    "kyc.upload_document": "Upload Document",
    "kyc.liveness_check": "Liveness Check",
    "kyc.nfc_scan": "Scan Passport NFC Chip",
    "fund.transfer": "Transfer",
    "fund.pending": "Pending",
    "fund.completed": "Completed",
    "fund.failed": "Failed",
    "security.maker_checker": "Requires Approval",
    "security.approval_required": "This operation requires dual authorization",
  },
  yo: {
    "common.send": "Fi owo rane",
    "common.receive": "Gba owo",
    "common.balance": "Iye owo",
    "common.loading": "N gbero...",
    "common.error": "Asise",
    "common.success": "Aseyori",
    "common.cancel": "Fagile",
    "common.confirm": "Jeri",
    "common.amount": "Iye",
    "common.currency": "Owo",
    "common.offline": "O wa ni ita ayelujara",
    "stablecoin.buy": "Ra Stablecoin",
    "stablecoin.sell": "Ta Stablecoin",
    "stablecoin.bridge": "Afara",
    "stablecoin.yield": "Jere ere",
    "stablecoin.dca": "Eto DCA",
    "stablecoin.card": "Kaadi Foju",
    "stablecoin.p2p": "Firanse Taara",
    "stablecoin.depeg_alert": "Ikilo De-Peg",
    "stablecoin.saga_protection": "Aabo nipase Temporal saga",
    "kyc.verify_identity": "Jeri Idanimo",
    "kyc.document_expired": "Iwe ti pari",
    "kyc.upload_document": "Gbe Iwe Soke",
    "kyc.liveness_check": "Ayewo Laaye",
    "kyc.nfc_scan": "Sikan NFC ti Iwe-irin-ajo",
    "fund.transfer": "Gbigbe owo",
    "fund.pending": "N duro",
    "fund.completed": "Ti pari",
    "fund.failed": "Ko se aseyori",
    "security.maker_checker": "Nilo Ifowosi",
    "security.approval_required": "Ise yi nilo ifowosi meji",
  },
  ig: {
    "common.send": "Ziga ego",
    "common.receive": "Nata ego",
    "common.balance": "Ego fodu",
    "common.loading": "Na-ebu...",
    "common.error": "Njehie",
    "common.success": "Ihe gara nke oma",
    "common.cancel": "Kagbuo",
    "common.confirm": "Kwado",
    "common.amount": "Ego ole",
    "common.currency": "Ego",
    "common.offline": "I no na intanet",
    "stablecoin.buy": "Zua Stablecoin",
    "stablecoin.sell": "Ree Stablecoin",
    "stablecoin.bridge": "Akwa mmiri",
    "stablecoin.yield": "Nweta uru",
    "stablecoin.dca": "Atumatu DCA",
    "stablecoin.card": "Kaadi Efu",
    "stablecoin.p2p": "Ziga onwe gi",
    "stablecoin.depeg_alert": "Oku De-Peg",
    "stablecoin.saga_protection": "Nchekwa site na Temporal saga",
    "kyc.verify_identity": "Nyochaa onwe gi",
    "kyc.document_expired": "Akwukwo agwula",
    "kyc.upload_document": "Bulite Akwukwo",
    "kyc.liveness_check": "Nyocha ndi",
    "kyc.nfc_scan": "Nyochaa NFC paspoto",
    "fund.transfer": "Nbufe ego",
    "fund.pending": "Na-eche",
    "fund.completed": "Emechara",
    "fund.failed": "Adaghachi",
    "security.maker_checker": "Choro Nkwado",
    "security.approval_required": "Oru a choro nkwado abuo",
  },
  ha: {
    "common.send": "Aika kudi",
    "common.receive": "Karba kudi",
    "common.balance": "Ragowar kudi",
    "common.loading": "Ana lodi...",
    "common.error": "Kuskure",
    "common.success": "Nasara",
    "common.cancel": "Soke",
    "common.confirm": "Tabbatar",
    "common.amount": "Adadi",
    "common.currency": "Kudin",
    "common.offline": "Ba ka da intanet",
    "stablecoin.buy": "Saya Stablecoin",
    "stablecoin.sell": "Sayar Stablecoin",
    "stablecoin.bridge": "Gada",
    "stablecoin.yield": "Samu riba",
    "stablecoin.dca": "Tsarin DCA",
    "stablecoin.card": "Katin Dijital",
    "stablecoin.p2p": "Aika kai tsaye",
    "stablecoin.depeg_alert": "Gargadin De-Peg",
    "stablecoin.saga_protection": "Kariyar Temporal saga",
    "kyc.verify_identity": "Tabbatar da kai",
    "kyc.document_expired": "Takarda ta kare",
    "kyc.upload_document": "Dora Takarda",
    "kyc.liveness_check": "Gwajin Raye-raye",
    "kyc.nfc_scan": "Duba NFC na fasfo",
    "fund.transfer": "Canja wuri",
    "fund.pending": "Ana jira",
    "fund.completed": "An kammala",
    "fund.failed": "Bai yi nasara ba",
    "security.maker_checker": "Ana Bukatar Amincewa",
    "security.approval_required": "Wannan aiki yana bukatar amincewa biyu",
  },
  fr: {
    "common.send": "Envoyer",
    "common.receive": "Recevoir",
    "common.balance": "Solde",
    "common.loading": "Chargement...",
    "common.error": "Erreur",
    "common.success": "Succes",
    "common.cancel": "Annuler",
    "common.confirm": "Confirmer",
    "common.amount": "Montant",
    "common.currency": "Devise",
    "common.offline": "Vous etes hors ligne",
    "stablecoin.buy": "Acheter Stablecoin",
    "stablecoin.sell": "Vendre Stablecoin",
    "stablecoin.bridge": "Pont",
    "stablecoin.yield": "Gagner du rendement",
    "stablecoin.dca": "Plan DCA",
    "stablecoin.card": "Carte Virtuelle",
    "stablecoin.p2p": "Transfert P2P",
    "stablecoin.depeg_alert": "Alerte De-Peg",
    "stablecoin.saga_protection": "Protege par Temporal saga",
    "kyc.verify_identity": "Verifier l'identite",
    "kyc.document_expired": "Document expire",
    "kyc.upload_document": "Telecharger un document",
    "kyc.liveness_check": "Verification de vivacite",
    "kyc.nfc_scan": "Scanner la puce NFC du passeport",
    "fund.transfer": "Transfert",
    "fund.pending": "En attente",
    "fund.completed": "Termine",
    "fund.failed": "Echoue",
    "security.maker_checker": "Approbation requise",
    "security.approval_required": "Cette operation necessite une double autorisation",
  },
  sw: {
    "common.send": "Tuma",
    "common.receive": "Pokea",
    "common.balance": "Salio",
    "common.loading": "Inapakia...",
    "common.error": "Hitilafu",
    "common.success": "Imefanikiwa",
    "common.cancel": "Ghairi",
    "common.confirm": "Thibitisha",
    "common.amount": "Kiasi",
    "common.currency": "Sarafu",
    "common.offline": "Huna mtandao",
    "stablecoin.buy": "Nunua Stablecoin",
    "stablecoin.sell": "Uza Stablecoin",
    "stablecoin.bridge": "Daraja",
    "stablecoin.yield": "Pata faida",
    "stablecoin.dca": "Mpango wa DCA",
    "stablecoin.card": "Kadi Pepe",
    "stablecoin.p2p": "Tuma moja kwa moja",
    "stablecoin.depeg_alert": "Tahadhari ya De-Peg",
    "stablecoin.saga_protection": "Inalindwa na Temporal saga",
    "kyc.verify_identity": "Thibitisha utambulisho",
    "kyc.document_expired": "Hati imeisha muda",
    "kyc.upload_document": "Pakia Hati",
    "kyc.liveness_check": "Ukaguzi wa uhai",
    "kyc.nfc_scan": "Changanua chipu ya NFC ya pasipoti",
    "fund.transfer": "Uhamisho",
    "fund.pending": "Inasubiri",
    "fund.completed": "Imekamilika",
    "fund.failed": "Imeshindwa",
    "security.maker_checker": "Inahitaji Idhini",
    "security.approval_required": "Operesheni hii inahitaji idhini mbili",
  },
  tw: {
    "common.send": "Mena sika",
    "common.receive": "Gye sika",
    "common.balance": "Sika a eka",
    "common.loading": "Eloade...",
    "common.error": "Mfomso",
    "common.success": "Aye adi yie",
    "common.cancel": "Twa mu",
    "common.confirm": "Si so mu",
    "common.amount": "Sika dodow",
    "common.currency": "Sika",
    "common.offline": "Wo nni intanet so",
    "stablecoin.buy": "To Stablecoin",
    "stablecoin.sell": "Ton Stablecoin",
    "stablecoin.bridge": "Bepow",
    "stablecoin.yield": "Nya mfaso",
    "stablecoin.dca": "DCA nhyehye",
    "stablecoin.card": "Kaad a enni ho",
    "stablecoin.p2p": "Mena nkorof",
    "stablecoin.depeg_alert": "De-Peg kokokbo",
    "stablecoin.saga_protection": "Temporal saga bom",
    "kyc.verify_identity": "Hwehwe wo ho",
    "kyc.document_expired": "Krataa no asa",
    "kyc.upload_document": "Fa Krataa To Ho",
    "kyc.liveness_check": "Nkwa nhwehwemu",
    "kyc.nfc_scan": "Scan passport NFC chip",
    "fund.transfer": "Sika mena",
    "fund.pending": "Retwn",
    "fund.completed": "Awie",
    "fund.failed": "Anka yie",
    "security.maker_checker": "Ehia Penee",
    "security.approval_required": "Adwuma yi hia penee mmienu",
  },
};

export function t(key: TranslationKey, locale: SupportedLocale = "en"): string {
  return translations[locale]?.[key] || translations.en[key] || key;
}

export function getLocaleDirection(locale: SupportedLocale): "ltr" | "rtl" {
  return "ltr"; // All supported locales are LTR
}
