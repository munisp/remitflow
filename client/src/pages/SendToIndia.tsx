import { CountryLandingPage, type CorridorConfig } from "@/components/CountryLandingPage";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const config: CorridorConfig = {
  flag: "🇮🇳",
  country: "India",
  currency: "INR",
  currencySymbol: "₹",
  language: "Hindi, English, and 21 other official languages",
  population: "18 million Indian diaspora worldwide — largest remittance recipient globally",
  paymentMethods: [
    "UPI instant transfer (any Indian bank via VPA)",
    "Bank transfer (SBI, HDFC, ICICI, Axis, Kotak)",
    "Paytm wallet deposit",
    "PhonePe / Google Pay UPI",
    "Direct to IFSC + account number",
    "NEFT/RTGS for large transfers",
  ],
  popularAmountsUSD: [100, 250, 500, 2000],
  mobileMoneyProvider: "UPI / Paytm / PhonePe",
  bankName: "SBI, HDFC Bank, ICICI Bank",
  heroTagline: "Send money to India — instant via UPI",
  heroSubtitle:
    "Your family in Mumbai, Delhi, Bangalore, or anywhere in India receives rupees instantly via UPI — to any bank account or mobile wallet. India receives over $100B in remittances annually, and RemitFlow makes it faster and cheaper.",
  testimonial: {
    name: "Priya S.",
    from: "London → Mumbai",
    quote:
      "My parents in Mumbai get the money within seconds through UPI. I just enter their VPA address and it's done. The rate is always better than what my bank offers, and the fees are a fraction of what Western Union charges.",
  },
  faqs: [
    {
      q: "How long does it take to send money to India?",
      a: "UPI transfers arrive within seconds — 24/7, including weekends. NEFT transfers settle within 2 hours during banking hours. RTGS is available for transfers over ₹2 lakh during banking hours.",
    },
    {
      q: "What is UPI and how do I use it?",
      a: "UPI (Unified Payments Interface) is India's real-time payment system operated by NPCI. Your recipient just needs a VPA (Virtual Payment Address like name@oksbi or name@paytm) linked to their bank account.",
    },
    {
      q: "What are the limits for sending to India?",
      a: "Up to $10,000 per transfer with basic KYC, $50,000 with enhanced verification. RBI's Liberalized Remittance Scheme (LRS) allows Indian residents to receive unlimited inbound remittances — there's no cap on receiving end.",
    },
    {
      q: "Do I need my recipient's bank details?",
      a: "For UPI, you only need their VPA address (e.g., name@oksbi). For bank transfers, you'll need the IFSC code and account number. We support all major Indian banks and payment apps.",
    },
    {
      q: "Is the exchange rate competitive?",
      a: "We offer mid-market INR rates with a transparent margin — typically 0.3-0.5% over interbank rate. No hidden fees or inflated spreads. You can lock the rate for 30 minutes while completing your transfer.",
    },
  ],
  relatedCorridors: [
    { flag: "🇨🇳", country: "China", route: "/send-to-china" },
    { flag: "🇧🇷", country: "Brazil", route: "/send-to-brazil" },
    { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria" },
    { flag: "🇰🇪", country: "Kenya", route: "/send-to-kenya" },
    { flag: "🇿🇦", country: "South Africa", route: "/send-to-south-africa" },
  ],
};

export default function SendToIndia() {
  const { t } = useTranslation();
  return (
    <DashboardLayout><CountryLandingPage config={config} /></DashboardLayout>
  );
}
