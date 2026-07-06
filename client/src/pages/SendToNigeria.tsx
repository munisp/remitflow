import { CountryLandingPage, type CorridorConfig } from "@/components/CountryLandingPage";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const config: CorridorConfig = {
  flag: "🇳🇬",
  country: "Nigeria",
  currency: "NGN",
  currencySymbol: "₦",
  language: "English, Yoruba, Igbo, Hausa",
  population: "1.7 million Nigerians in the UK, US, and Canada",
  paymentMethods: [
    "Bank transfer (GTBank, Access, Zenith, UBA, First Bank)",
    "Mobile money (OPay, PalmPay, Kuda)",
    "Cash pickup at agent locations",
    "Airtime top-up (MTN, Airtel, Glo, 9mobile)",
    "USSD — no smartphone needed",
    "Direct to any Nigerian bank account",
  ],
  popularAmountsUSD: [100, 250, 500, 1000],
  mobileMoneyProvider: "OPay / PalmPay",
  bankName: "GTBank, Access Bank, Zenith",
  heroTagline: "Send money to Nigeria — fast, cheap, and safe",
  heroSubtitle:
    "Your family in Lagos, Abuja, Port Harcourt, or anywhere in Nigeria receives naira directly to their bank account or mobile wallet — in minutes, not days. Pay up to 5x less than your bank charges.",
  testimonial: {
    name: "Adaeze O.",
    from: "London → Lagos",
    quote:
      "I used to pay £25 every time I sent money home. With RemitFlow, I pay less than £3 and my mum gets it the same day. My family in Lagos never has to wait anymore.",
  },
  faqs: [
    {
      q: "How long does it take to send money to Nigeria?",
      a: "Most transfers to Nigeria arrive within 2 minutes. Bank-to-bank transfers may occasionally take up to 30 minutes during peak hours, but are still same-day in all cases.",
    },
    {
      q: "What is the maximum I can send to Nigeria?",
      a: "After completing basic identity verification, you can send up to $10,000 per transfer and $50,000 per month. Higher limits are available with enhanced KYC.",
    },
    {
      q: "Can my family receive naira without a bank account?",
      a: "Yes. Your family can receive money via OPay, PalmPay, or Kuda mobile wallets, or collect cash at one of our 2,000+ agent pickup locations across Nigeria.",
    },
    {
      q: "Is RemitFlow safe to use for sending money to Nigeria?",
      a: "RemitFlow is fully authorised by the UK Financial Conduct Authority (FCA) and uses bank-grade encryption. Your money is protected and insured at every step of the transfer.",
    },
    {
      q: "Can I pay Nigerian utility bills and DSTV from abroad?",
      a: "Yes. RemitFlow lets you pay electricity (PHCN/IKEDC/EKEDC), water, DSTV, and school fees directly from your phone — no need to ask anyone to run to the bank.",
    },
  ],
  relatedCorridors: [
    { flag: "🇬🇭", country: "Ghana", route: "/send-to-ghana" },
    { flag: "🇰🇪", country: "Kenya", route: "/send-to-kenya" },
    { flag: "🇨🇳", country: "China", route: "/send-to-china" },
    { flag: "🇧🇷", country: "Brazil", route: "/send-to-brazil" },
    { flag: "🇮🇳", country: "India", route: "/send-to-india" },
  ],
};

export default function SendToNigeria() {
  const { t } = useTranslation();
  return (
    <DashboardLayout><CountryLandingPage config={config} /></DashboardLayout>
  );
}
