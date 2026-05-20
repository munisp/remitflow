import { CountryLandingPage, type CorridorConfig } from "@/components/CountryLandingPage";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const config: CorridorConfig = {
  flag: "🇺🇬",
  country: "Uganda",
  currency: "UGX",
  currencySymbol: "USh",
  language: "English, Luganda, Swahili",
  population: "100,000+ Ugandans in the UK, US, and Canada",
  paymentMethods: [
    "MTN Mobile Money",
    "Airtel Money",
    "Bank transfer (Stanbic, DFCU, Centenary Bank)",
    "Cash pickup at agent locations",
    "Airtime top-up (MTN, Airtel)",
  ],
  popularAmountsUSD: [100, 250, 500, 1000],
  mobileMoneyProvider: "MTN Mobile Money / Airtel Money",
  bankName: "Stanbic Bank, DFCU, Centenary",
  heroTagline: "Send money to Uganda — straight to MTN MoMo",
  heroSubtitle:
    "Your family in Kampala, Entebbe, Gulu, or anywhere in Uganda receives shillings directly to their MTN Mobile Money or Airtel Money — in minutes, at the best rates.",
  testimonial: {
    name: "Grace K.",
    from: "London → Kampala",
    quote:
      "My parents in Kampala use MTN MoMo for everything. RemitFlow sends straight to their number and they get it instantly. I save so much compared to what I used to pay.",
  },
  faqs: [
    {
      q: "How do I send money to MTN Mobile Money in Uganda?",
      a: "Enter your recipient's MTN phone number when sending. The funds arrive in their MTN MoMo wallet within minutes.",
    },
    {
      q: "Can I send to Airtel Money in Uganda?",
      a: "Yes. RemitFlow supports both MTN Mobile Money and Airtel Money in Uganda.",
    },
    {
      q: "What is the exchange rate for UGX?",
      a: "The live rate is shown at the top of this page and is updated every 5 minutes.",
    },
    {
      q: "How long does a transfer to Uganda take?",
      a: "Mobile money transfers typically arrive in under 2 minutes. Bank transfers may take up to 30 minutes.",
    },
  ],
  relatedCorridors: [
    { flag: "🇰🇪", country: "Kenya", route: "/send-to-kenya" },
    { flag: "🇹🇿", country: "Tanzania", route: "/send-to-tanzania" },
    { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria" },
    { flag: "🇬🇭", country: "Ghana", route: "/send-to-ghana" },
    { flag: "🇿🇦", country: "South Africa", route: "/send-to-south-africa" },
  ],
};

export default function SendToUganda() {
  const { t } = useTranslation();
  return (
    <DashboardLayout><CountryLandingPage config={config} /></DashboardLayout>
  );
}
