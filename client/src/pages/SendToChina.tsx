import { CountryLandingPage, type CorridorConfig } from "@/components/CountryLandingPage";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const config: CorridorConfig = {
  flag: "🇨🇳",
  country: "China",
  currency: "CNY",
  currencySymbol: "¥",
  language: "Mandarin, Cantonese",
  population: "5.5 million Chinese diaspora in US, Canada, UK, and Europe",
  paymentMethods: [
    "Bank transfer via CIPS (ICBC, BOC, CCB, ABC, CMBC)",
    "Alipay direct deposit",
    "WeChat Pay wallet top-up",
    "UnionPay card deposit",
    "Direct to any Chinese bank account (CNAPS)",
    "Cross-border RMB settlement",
  ],
  popularAmountsUSD: [200, 500, 1000, 5000],
  mobileMoneyProvider: "Alipay / WeChat Pay",
  bankName: "ICBC, Bank of China, CCB",
  heroTagline: "Send money to China — fast via CIPS, low fees",
  heroSubtitle:
    "Your family in Beijing, Shanghai, Guangzhou, or anywhere in China receives yuan directly to their bank account or Alipay wallet — settled within 2 hours via CIPS. Up to 70% cheaper than traditional wire transfers.",
  testimonial: {
    name: "Wei L.",
    from: "Toronto → Shanghai",
    quote:
      "I used to pay $45 per wire transfer to send money to my parents. With RemitFlow's CIPS integration, I pay under $5 and it arrives the same day. The exchange rate is much better too.",
  },
  faqs: [
    {
      q: "How long does it take to send money to China?",
      a: "CIPS transfers typically settle within 2-4 hours during business hours (Beijing time). Weekend transfers may take until the next business day.",
    },
    {
      q: "What is CIPS and how does it work?",
      a: "CIPS (Cross-Border Interbank Payment System) is China's modern payment rail for cross-border RMB transactions. It uses ISO 20022 messaging and provides faster, cheaper transfers than traditional SWIFT wires to China.",
    },
    {
      q: "What are the transfer limits for China?",
      a: "Individual transfers up to $50,000 USD equivalent per transaction. China's SAFE (State Administration of Foreign Exchange) requires annual quota tracking for individuals — we handle this automatically.",
    },
    {
      q: "Do I need to provide additional documentation for China transfers?",
      a: "For transfers over CNY 200,000, PBoC (People's Bank of China) requires a Large Transaction Report which we file automatically. All cross-border RMB transfers include SAFE cross-border declaration — no extra steps from you.",
    },
    {
      q: "Can I send to Alipay or WeChat Pay?",
      a: "Yes. Recipients can receive funds directly to their Alipay or WeChat Pay wallet, or to any Chinese bank account via CNAPS routing.",
    },
  ],
  relatedCorridors: [
    { flag: "🇮🇳", country: "India", route: "/send-to-india" },
    { flag: "🇧🇷", country: "Brazil", route: "/send-to-brazil" },
    { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria" },
    { flag: "🇰🇪", country: "Kenya", route: "/send-to-kenya" },
    { flag: "🇬🇭", country: "Ghana", route: "/send-to-ghana" },
  ],
};

export default function SendToChina() {
  const { t } = useTranslation();
  return (
    <DashboardLayout><CountryLandingPage config={config} /></DashboardLayout>
  );
}
