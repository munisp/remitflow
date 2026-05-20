import { CountryLandingPage, type CorridorConfig } from "@/components/CountryLandingPage";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const config: CorridorConfig = {
  flag: "🇸🇳",
  country: "Senegal",
  currency: "XOF",
  currencySymbol: "CFA",
  language: "French, Wolof, Pulaar",
  population: "600,000+ Senegalese in France, Italy, Spain, and the US",
  paymentMethods: [
    "Orange Money",
    "Wave (mobile money)",
    "Free Money",
    "Bank transfer (CBAO, BIS, Ecobank Senegal)",
    "Cash pickup at Western Union & MoneyGram partners",
    "Airtime top-up (Orange, Free, Expresso)",
  ],
  popularAmountsUSD: [100, 250, 500, 1000],
  mobileMoneyProvider: "Orange Money / Wave",
  bankName: "CBAO, BIS, Ecobank",
  heroTagline: "Envoyez de l'argent au Sénégal — rapide et sans frais excessifs",
  heroSubtitle:
    "Your family in Dakar, Thiès, Ziguinchor, or anywhere in Senegal receives CFA francs directly to their Orange Money or Wave wallet — in minutes. Pay up to 5x less than traditional transfer services.",
  testimonial: {
    name: "Fatima D.",
    from: "Paris → Dakar",
    quote:
      "I started a community savings group with 12 friends from Senegal. We pooled money to invest in a business back home. RemitFlow made it so simple — and the fees are much lower than what we paid before.",
  },
  faqs: [
    {
      q: "How do I send money to Orange Money in Senegal?",
      a: "Enter your recipient's Orange phone number when sending. The funds arrive in their Orange Money wallet within minutes, ready to spend or withdraw at any Orange Money agent.",
    },
    {
      q: "Can I send to Wave wallets in Senegal?",
      a: "Yes. RemitFlow supports Wave, which is widely used in Senegal for its zero-fee domestic transfers. Your recipient can receive funds directly to their Wave account.",
    },
    {
      q: "What is the exchange rate for XOF (CFA franc)?",
      a: "The CFA franc (XOF) is pegged to the Euro. The live rate is shown at the top of this page and is updated every 5 minutes.",
    },
    {
      q: "How long does a transfer to Senegal take?",
      a: "Mobile money transfers (Orange Money, Wave) typically arrive in under 2 minutes. Bank transfers may take up to 2 hours.",
    },
    {
      q: "Can I send money to Senegal from France or Italy?",
      a: "Yes. RemitFlow supports sending from over 30 countries, including France, Italy, Spain, the UK, and the US. The process is the same regardless of where you are sending from.",
    },
  ],
  relatedCorridors: [
    { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria" },
    { flag: "🇬🇭", country: "Ghana", route: "/send-to-ghana" },
    { flag: "🇨🇲", country: "Cameroon", route: "/send-to-cameroon" },
    { flag: "🇰🇪", country: "Kenya", route: "/send-to-kenya" },
    { flag: "🇿🇦", country: "South Africa", route: "/send-to-south-africa" },
  ],
};

export default function SendToSenegal() {
  const { t } = useTranslation();
  return (
    <DashboardLayout><CountryLandingPage config={config} /></DashboardLayout>
  );
}
