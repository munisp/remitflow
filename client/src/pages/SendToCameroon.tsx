import { CountryLandingPage, type CorridorConfig } from "@/components/CountryLandingPage";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const config: CorridorConfig = {
  flag: "🇨🇲",
  country: "Cameroon",
  currency: "XAF",
  currencySymbol: "FCFA",
  language: "French, English",
  population: "200,000+ Cameroonians in France, the UK, and the US",
  paymentMethods: [
    "MTN Mobile Money",
    "Orange Money",
    "Bank transfer (Afriland First Bank, SCB Cameroun, Ecobank)",
    "Cash pickup at agent locations",
    "Airtime top-up (MTN, Orange, Nexttel)",
  ],
  popularAmountsUSD: [100, 250, 500, 1000],
  mobileMoneyProvider: "MTN Mobile Money / Orange Money",
  bankName: "Afriland First Bank, Ecobank",
  heroTagline: "Send money to Cameroon — to MTN MoMo or Orange Money",
  heroSubtitle:
    "Your family in Douala, Yaoundé, Bafoussam, or anywhere in Cameroon receives CFA francs directly to their mobile money wallet or bank account — in minutes, not days.",
  testimonial: {
    name: "Serge N.",
    from: "Paris → Douala",
    quote:
      "Sending money home to Cameroon used to take 3 days and cost a fortune. With RemitFlow, my family gets it in minutes and I save over €20 on every transfer.",
  },
  faqs: [
    {
      q: "How do I send money to MTN Mobile Money in Cameroon?",
      a: "Enter your recipient's MTN phone number when sending. The funds arrive in their MTN Mobile Money wallet within minutes.",
    },
    {
      q: "Can I send to Orange Money in Cameroon?",
      a: "Yes. RemitFlow supports both MTN Mobile Money and Orange Money in Cameroon.",
    },
    {
      q: "What is the exchange rate for XAF (CFA franc)?",
      a: "The Central African CFA franc (XAF) is pegged to the Euro. The live rate is shown at the top of this page.",
    },
    {
      q: "How long does a transfer to Cameroon take?",
      a: "Mobile money transfers typically arrive in under 2 minutes. Bank transfers may take up to 2 hours.",
    },
  ],
  relatedCorridors: [
    { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria" },
    { flag: "🇸🇳", country: "Senegal", route: "/send-to-senegal" },
    { flag: "🇬🇭", country: "Ghana", route: "/send-to-ghana" },
    { flag: "🇰🇪", country: "Kenya", route: "/send-to-kenya" },
    { flag: "🇿🇦", country: "South Africa", route: "/send-to-south-africa" },
  ],
};

export default function SendToCameroon() {
  const { t } = useTranslation();
  return (
    <DashboardLayout><CountryLandingPage config={config} /></DashboardLayout>
  );
}
