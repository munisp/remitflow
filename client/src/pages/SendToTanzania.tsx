import { CountryLandingPage, type CorridorConfig } from "@/components/CountryLandingPage";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const config: CorridorConfig = {
  flag: "🇹🇿",
  country: "Tanzania",
  currency: "TZS",
  currencySymbol: "TSh",
  language: "Swahili, English",
  population: "80,000+ Tanzanians in the UK, US, and Canada",
  paymentMethods: [
    "M-Pesa Tanzania",
    "Tigo Pesa",
    "Airtel Money",
    "Vodacom M-Pesa",
    "Bank transfer (CRDB, NMB, NBC, Stanbic Tanzania)",
    "Airtime top-up (Vodacom, Tigo, Airtel, Halotel)",
  ],
  popularAmountsUSD: [100, 250, 500, 1000],
  mobileMoneyProvider: "M-Pesa / Tigo Pesa",
  bankName: "CRDB Bank, NMB Bank",
  heroTagline: "Send money to Tanzania — to M-Pesa or Tigo Pesa",
  heroSubtitle:
    "Your family in Dar es Salaam, Arusha, Mwanza, or anywhere in Tanzania receives shillings directly to their mobile money wallet or bank account — in minutes.",
  testimonial: {
    name: "Amina J.",
    from: "London → Dar es Salaam",
    quote:
      "My family in Dar es Salaam uses Tigo Pesa. RemitFlow sends straight to their wallet and they get it in minutes. It is so much better than what I used before.",
  },
  faqs: [
    {
      q: "How do I send money to M-Pesa in Tanzania?",
      a: "Enter your recipient's Vodacom Tanzania phone number when sending. The funds arrive in their M-Pesa wallet within minutes.",
    },
    {
      q: "Can I send to Tigo Pesa or Airtel Money in Tanzania?",
      a: "Yes. RemitFlow supports M-Pesa, Tigo Pesa, and Airtel Money in Tanzania.",
    },
    {
      q: "What is the exchange rate for TZS?",
      a: "The live rate is shown at the top of this page and is updated every 5 minutes.",
    },
    {
      q: "How long does a transfer to Tanzania take?",
      a: "Mobile money transfers typically arrive in under 2 minutes. Bank transfers may take up to 30 minutes.",
    },
  ],
  relatedCorridors: [
    { flag: "🇰🇪", country: "Kenya", route: "/send-to-kenya" },
    { flag: "🇺🇬", country: "Uganda", route: "/send-to-uganda" },
    { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria" },
    { flag: "🇬🇭", country: "Ghana", route: "/send-to-ghana" },
    { flag: "🇿🇦", country: "South Africa", route: "/send-to-south-africa" },
  ],
};

export default function SendToTanzania() {
  const { t } = useTranslation();
  return (
    <DashboardLayout><CountryLandingPage config={config} /></DashboardLayout>
  );
}
