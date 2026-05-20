import { CountryLandingPage, type CorridorConfig } from "@/components/CountryLandingPage";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const config: CorridorConfig = {
  flag: "🇰🇪",
  country: "Kenya",
  currency: "KES",
  currencySymbol: "KSh",
  language: "English, Swahili",
  population: "100,000+ Kenyans in the UK, US, and Canada",
  paymentMethods: [
    "M-Pesa (direct to phone number)",
    "Airtel Money",
    "Bank transfer (Equity, KCB, Co-op, Absa Kenya)",
    "Cash pickup at M-Pesa agents",
    "Airtime top-up (Safaricom, Airtel)",
    "Paybill & Till number payments",
  ],
  popularAmountsUSD: [100, 250, 500, 1000],
  mobileMoneyProvider: "M-Pesa",
  bankName: "Equity Bank, KCB, Co-op Bank",
  heroTagline: "Send money to Kenya — straight to M-Pesa",
  heroSubtitle:
    "Your family in Nairobi, Mombasa, Kisumu, or anywhere in Kenya receives shillings directly to their M-Pesa — in minutes. No bank account needed. Just a phone number.",
  testimonial: {
    name: "James M.",
    from: "London → Nairobi",
    quote:
      "Sending to M-Pesa with RemitFlow is the easiest thing. My mum gets a notification within seconds. I do not have to call to check if the money arrived — she just messages me.",
  },
  faqs: [
    {
      q: "How do I send money to M-Pesa in Kenya?",
      a: "Enter your recipient's Safaricom phone number (the one registered with M-Pesa) when sending. The funds arrive in their M-Pesa wallet within minutes.",
    },
    {
      q: "Does my family need a bank account to receive money?",
      a: "No. M-Pesa works on any Safaricom SIM card. Your family can receive, spend, and withdraw money without a bank account.",
    },
    {
      q: "Can I pay Kenyan bills from abroad?",
      a: "Yes. RemitFlow supports Paybill and Till number payments, so you can pay KPLC electricity, water bills, school fees, and more directly from your phone.",
    },
    {
      q: "What is the current USD to KES exchange rate?",
      a: "The live rate is shown at the top of this page and is updated every 5 minutes. RemitFlow uses the mid-market rate with no hidden markup.",
    },
    {
      q: "How long does a transfer to Kenya take?",
      a: "M-Pesa transfers typically arrive in under 2 minutes. Bank transfers may take up to 30 minutes but are always same-day.",
    },
  ],
  relatedCorridors: [
    { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria" },
    { flag: "🇬🇭", country: "Ghana", route: "/send-to-ghana" },
    { flag: "🇸🇳", country: "Senegal", route: "/send-to-senegal" },
    { flag: "🇺🇬", country: "Uganda", route: "/send-to-uganda" },
    { flag: "🇹🇿", country: "Tanzania", route: "/send-to-tanzania" },
  ],
};

export default function SendToKenya() {
  const { t } = useTranslation();
  return (
    <DashboardLayout><CountryLandingPage config={config} /></DashboardLayout>
  );
}
