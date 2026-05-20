import { CountryLandingPage, type CorridorConfig } from "@/components/CountryLandingPage";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const config: CorridorConfig = {
  flag: "🇿🇦",
  country: "South Africa",
  currency: "ZAR",
  currencySymbol: "R",
  language: "English, Zulu, Xhosa, Afrikaans",
  population: "300,000+ South Africans in the UK, Australia, and the US",
  paymentMethods: [
    "Bank transfer (Standard Bank, FNB, Absa, Nedbank, Capitec)",
    "Capitec Pay",
    "Cash pickup at agent locations",
    "Airtime top-up (Vodacom, MTN, Cell C, Telkom)",
  ],
  popularAmountsUSD: [100, 250, 500, 1000],
  bankName: "Standard Bank, FNB, Capitec",
  heroTagline: "Send money to South Africa — fast and affordable",
  heroSubtitle:
    "Your family in Johannesburg, Cape Town, Durban, or anywhere in South Africa receives rand directly to their bank account — in minutes. No more expensive bank wire fees.",
  testimonial: {
    name: "Thabo M.",
    from: "London → Johannesburg",
    quote:
      "I was paying R800 in fees every time I sent money home. RemitFlow charges a fraction of that and the money arrives the same day. My family in Joburg is very happy.",
  },
  faqs: [
    {
      q: "How do I send money to a South African bank account?",
      a: "Enter your recipient's bank name, account number, and branch code when sending. Funds arrive directly to their account within minutes.",
    },
    {
      q: "What is the current USD to ZAR exchange rate?",
      a: "The live rate is shown at the top of this page and is updated every 5 minutes. RemitFlow uses the mid-market rate with no hidden markup.",
    },
    {
      q: "How long does a transfer to South Africa take?",
      a: "Most bank transfers to South Africa arrive within 2–30 minutes. All transfers are same-day.",
    },
    {
      q: "Can I send airtime to South Africa?",
      a: "Yes. RemitFlow supports airtime top-ups for Vodacom, MTN, Cell C, and Telkom — directly from your phone.",
    },
  ],
  relatedCorridors: [
    { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria" },
    { flag: "🇬🇭", country: "Ghana", route: "/send-to-ghana" },
    { flag: "🇰🇪", country: "Kenya", route: "/send-to-kenya" },
    { flag: "🇺🇬", country: "Uganda", route: "/send-to-uganda" },
    { flag: "🇹🇿", country: "Tanzania", route: "/send-to-tanzania" },
  ],
};

export default function SendToSouthAfrica() {
  const { t } = useTranslation();
  return (
    <DashboardLayout><CountryLandingPage config={config} /></DashboardLayout>
  );
}
