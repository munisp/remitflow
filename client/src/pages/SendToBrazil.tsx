import { CountryLandingPage, type CorridorConfig } from "@/components/CountryLandingPage";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const config: CorridorConfig = {
  flag: "🇧🇷",
  country: "Brazil",
  currency: "BRL",
  currencySymbol: "R$",
  language: "Portuguese",
  population: "1.9 million Brazilians in the US, Europe, and Japan",
  paymentMethods: [
    "PIX instant transfer (any Brazilian bank or fintech)",
    "Bank transfer (Itaú, Bradesco, Banco do Brasil, Santander, Nubank)",
    "Boleto bancário payment",
    "Direct to CPF/CNPJ via PIX key",
    "Email or phone number PIX key",
    "Cross-border real-time settlement",
  ],
  popularAmountsUSD: [100, 300, 500, 1000],
  mobileMoneyProvider: "PIX / Nubank",
  bankName: "Itaú, Bradesco, Banco do Brasil",
  heroTagline: "Send money to Brazil — instant via PIX",
  heroSubtitle:
    "Your family in São Paulo, Rio, Belo Horizonte, or anywhere in Brazil receives reais instantly via PIX — 24/7, including weekends and holidays. No waiting, no high fees.",
  testimonial: {
    name: "Carlos M.",
    from: "Miami → São Paulo",
    quote:
      "PIX through RemitFlow is incredible. I sent money at 11pm on a Sunday and my mother had it in her Nubank account within seconds. The old bank wire took 3 days and cost 10x more.",
  },
  faqs: [
    {
      q: "How long does it take to send money to Brazil?",
      a: "PIX transfers are instant — your recipient receives reais within seconds, 24/7/365 including weekends and holidays. This is the fastest way to send money to Brazil.",
    },
    {
      q: "What is PIX?",
      a: "PIX is Brazil's instant payment system operated by the Central Bank of Brazil (BCB). It allows real-time transfers using a PIX key (CPF, email, phone, or random key) to any Brazilian bank or fintech account.",
    },
    {
      q: "What PIX key types are supported?",
      a: "We support all PIX key types: CPF/CNPJ (tax ID), email address, phone number (+55), and random EVP keys. Just enter your recipient's PIX key and we handle the rest.",
    },
    {
      q: "What are the fees for sending to Brazil?",
      a: "RemitFlow charges a flat fee starting at $2.99 for PIX transfers. No hidden markups on the exchange rate — we use the commercial BRL rate, not the tourist rate.",
    },
    {
      q: "Is there a maximum I can send to Brazil?",
      a: "You can send up to $10,000 per transfer with basic verification, and up to $50,000 with enhanced KYC. Brazilian regulations (BCB Circular 3,691) may require additional documentation for large inbound transfers.",
    },
  ],
  relatedCorridors: [
    { flag: "🇨🇳", country: "China", route: "/send-to-china" },
    { flag: "🇮🇳", country: "India", route: "/send-to-india" },
    { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria" },
    { flag: "🇲🇽", country: "Mexico", route: "/send-to-mexico" },
    { flag: "🇰🇪", country: "Kenya", route: "/send-to-kenya" },
  ],
};

export default function SendToBrazil() {
  const { t } = useTranslation();
  return (
    <DashboardLayout><CountryLandingPage config={config} /></DashboardLayout>
  );
}
