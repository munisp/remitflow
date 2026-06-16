import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation, Link } from "wouter";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import LiveTransferTicker from "@/components/LiveTransferTicker";
import {
  ArrowRight, Send, TrendingUp, Users, Heart, Smartphone,
  CheckCircle, Star, Globe, ShieldCheck, Zap, Wallet,
  Phone, Home as HomeIcon, PiggyBank, Download, X, Share,
  ChevronRight, DollarSign, Clock, Lock, Gift, BadgeCheck,
  Banknote, CreditCard, AlertCircle
} from "lucide-react";
import { useTranslation } from 'react-i18next';

// ─── PWA Install Logic ────────────────────────────────────────────────────────
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone) {
      setIsInstalled(true); return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);
    if (ios) { setIsInstallable(true); return; }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setIsInstalled(true);
    setDeferredPrompt(null);
  };

  return { isInstallable, isInstalled, isIOS, install };
}

// ─── Static Data ──────────────────────────────────────────────────────────────
const STATS = [
  { value: "₦2.8B+", label: "Sent home every month" },
  { value: "150+", label: "Countries supported" },
  { value: "2 min", label: "Average delivery time" },
  { value: "1.2%", label: "Average fee — vs 6.5% at banks" },
];

const FEATURES = [
  {
    icon: <Send className="h-6 w-6" />,
    color: "from-blue-500/20 to-blue-600/10 border-blue-500/20",
    iconColor: "text-blue-400",
    title: "Send Money Home",
    desc: "Transfer money to your family in Nigeria, Ghana, Kenya, Senegal, and 150+ countries — in minutes, not days. Your loved ones receive funds directly to their bank account, mobile wallet, or cash pickup point.",
  },
  {
    icon: <TrendingUp className="h-6 w-6" />,
    color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/20",
    iconColor: "text-emerald-400",
    title: "Invest in Your Roots",
    desc: "Put your money to work back home. Buy shares in African companies, government bonds, and real estate projects — all from your phone. Build wealth in the country you came from while living abroad.",
  },
  {
    icon: <Users className="h-6 w-6" />,
    color: "from-violet-500/20 to-violet-600/10 border-violet-500/20",
    iconColor: "text-violet-400",
    title: "Save Together as a Community",
    desc: "Start or join a community savings group — just like the ajo, susu, or chama you know from home. Pool money with friends and family, set a shared goal, and watch your community grow stronger together.",
  },
  {
    icon: <Heart className="h-6 w-6" />,
    color: "from-rose-500/20 to-rose-600/10 border-rose-500/20",
    iconColor: "text-rose-400",
    title: "Support Your Family",
    desc: "Set up a family budget so your parents, siblings, or children always have what they need. Schedule regular transfers, track how money is being used, and never miss a school fee or medical bill again.",
  },
  {
    icon: <Phone className="h-6 w-6" />,
    color: "from-amber-500/20 to-amber-600/10 border-amber-500/20",
    iconColor: "text-amber-400",
    title: "Pay Bills & Top Up Airtime",
    desc: "Pay electricity, water, DSTV, and school fees for family back home — without asking anyone to run to the bank. Top up airtime for your mum in Lagos or your brother in Accra in seconds.",
  },
  {
    icon: <PiggyBank className="h-6 w-6" />,
    color: "from-cyan-500/20 to-cyan-600/10 border-cyan-500/20",
    iconColor: "text-cyan-400",
    title: "Save for What Matters",
    desc: "Set savings goals for the things that matter — a trip home, a business in your home country, your child's education. Automate deposits and watch your goal fill up, one transfer at a time.",
  },
];

const HOW_IT_WORKS = [
  { step: "1", title: "Create your free account", desc: "Sign up in under 2 minutes. No paperwork, no branch visit — just your phone and ID." },
  { step: "2", title: "Add money to your wallet", desc: "Fund your RemitFlow wallet by bank transfer, debit card, or mobile money. Funds are available instantly." },
  { step: "3", title: "Send, invest, or save", desc: "Choose what to do with your money. Send it home, invest in Africa, or save for a goal — all in one place." },
];

const TESTIMONIALS = [
  {
    name: "Adaeze O.",
    location: "London → Lagos",
    quote: "I used to pay £25 every time I sent money home. With RemitFlow, I pay less than £3 and my mum gets it the same day. It changed everything.",
    stars: 5,
  },
  {
    name: "Kwame A.",
    location: "Toronto → Accra",
    quote: "My whole family back in Ghana depends on me. RemitFlow lets me set up automatic monthly transfers so I never forget — and they never go without.",
    stars: 5,
  },
  {
    name: "Fatima D.",
    location: "Paris → Dakar",
    quote: "I started a community savings group with 12 friends from Senegal. We pooled money to invest in a business back home. RemitFlow made it so simple.",
    stars: 5,
  },
];

const TRUST_BADGES = [
  { icon: <ShieldCheck className="h-4 w-4" />, label: "FCA Regulated" },
  { icon: <Lock className="h-4 w-4" />, label: "Bank-Grade Encryption" },
  { icon: <CheckCircle className="h-4 w-4" />, label: "GDPR Compliant" },
  { icon: <Globe className="h-4 w-4" />, label: "150+ Countries" },
];

const CORRIDORS = [
  { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria", currency: "NGN", popular: true,  todayCount: 2847, hot: true },
  { flag: "🇬🇭", country: "Ghana",   route: "/send-to-ghana",   currency: "GHS", popular: true,  todayCount: 1203, hot: true },
  { flag: "🇰🇪", country: "Kenya",   route: "/send-to-kenya",   currency: "KES", popular: true,  todayCount:  984, hot: false },
  { flag: "🇸🇳", country: "Senegal", route: "/send-to-senegal", currency: "XOF", popular: false, todayCount:  412, hot: false },
  { flag: "🇨🇲", country: "Cameroon",    route: "/send-to-cameroon",     currency: "XAF", popular: false, todayCount:  318, hot: false },
  { flag: "🇿🇦", country: "South Africa", route: "/send-to-south-africa", currency: "ZAR", popular: false, todayCount:  276, hot: false },
  { flag: "🇺🇬", country: "Uganda",       route: "/send-to-uganda",      currency: "UGX", popular: false, todayCount:  195, hot: false },
  { flag: "🇹🇿", country: "Tanzania",     route: "/send-to-tanzania",    currency: "TZS", popular: false, todayCount:  148, hot: false },
];

// Fee comparison data — amounts in USD, NGN equivalent computed dynamically
type FeeRow = {
  provider: string;
  feeUSD: number;
  feeNGN: number; // at 1 USD = 1540 NGN approx
  deliveryTime: string;
  exchangeRate: string; // how much recipient gets per $100 sent
  highlight: boolean;
};

function buildFeeRows(ngnRate: number, sendAmountUSD: number): FeeRow[] {
  const sendNGN = sendAmountUSD * ngnRate;
  return [
    {
      provider: "RemitFlow",
      feeUSD: sendAmountUSD * 0.012,
      feeNGN: sendNGN * 0.012,
      deliveryTime: "~2 minutes",
      exchangeRate: "Mid-market rate",
      highlight: true,
    },
    {
      provider: "Western Union",
      feeUSD: sendAmountUSD * 0.055,
      feeNGN: sendNGN * 0.055,
      deliveryTime: "1–3 days",
      exchangeRate: "2.5% below mid-market",
      highlight: false,
    },
    {
      provider: "Your Bank (Wire)",
      feeUSD: sendAmountUSD * 0.065 + 15,
      feeNGN: sendNGN * 0.065 + 15 * ngnRate,
      deliveryTime: "3–5 days",
      exchangeRate: "3–4% below mid-market",
      highlight: false,
    },
    {
      provider: "MoneyGram",
      feeUSD: sendAmountUSD * 0.048,
      feeNGN: sendNGN * 0.048,
      deliveryTime: "Minutes–1 day",
      exchangeRate: "2% below mid-market",
      highlight: false,
    },
  ];
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Home() {
  const { t } = useTranslation();
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [feeCurrency, setFeeCurrency] = useState<"USD" | "NGN">("USD");
  const [sendAmount, setSendAmount] = useState(500);

  // Fetch live FX rates for NGN
  const { data: fxRates, isLoading, isError } = trpc.fx.rates.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const ngnRate = fxRates?.find(r => r.currency === "NGN")?.rate ?? 1540;
  const feeRows = buildFeeRows(ngnRate, sendAmount);

  useEffect(() => {
    if (!loading && isAuthenticated) navigate("/dashboard");
  }, [isAuthenticated, loading]);

  const handleInstall = () => {
    if (isIOS) { setShowIOSGuide(true); return; }
    install();
  };

  const fmt = (usd: number, ngn: number) =>
    feeCurrency === "USD"
      ? `$${usd.toFixed(2)}`
      : `₦${ngn.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

  const fmtSend = () =>
    feeCurrency === "USD"
      ? `$${sendAmount.toLocaleString()}`
      : `₦${(sendAmount * ngnRate).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Live Transfer Ticker ── */}
      <LiveTransferTicker />

      {/* ── Sticky Nav ── */}
      <nav className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/manus-storage/icon-192_d0405887.png" alt="RemitFlow" className="w-8 h-8 rounded-lg object-cover" />
            <span className="font-bold text-lg tracking-tight">RemitFlow</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {!isInstalled && isInstallable && (
              <Button variant="outline" size="sm" onClick={handleInstall}
                className="hidden sm:flex gap-1.5 border-primary/30 text-primary hover:bg-primary/10">
                <Download className="h-3.5 w-3.5" /> Get the App
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => window.location.href = getLoginUrl()}>Sign In</Button>
            <Button size="sm" onClick={() => window.location.href = getLoginUrl()} className="gap-1.5">
              Start Free <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* ── iOS Install Guide Modal ── */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <img src="/manus-storage/icon-192_d0405887.png" alt="RemitFlow" className="w-8 h-8 rounded-lg" />
                <span className="font-semibold text-white">Install RemitFlow</span>
              </div>
              <button onClick={() => setShowIOSGuide(false)} className="text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-gray-400 mb-4">Add RemitFlow to your home screen for the full app experience:</p>
            <div className="space-y-3">
              {[
                { n: "1", t: <>Tap the <Share className="inline h-4 w-4 text-blue-400" /> Share button in Safari</> },
                { n: "2", t: <>Scroll down and tap <strong className="text-white">"Add to Home Screen"</strong></> },
                { n: "3", t: <>Tap <strong className="text-white">Add</strong> in the top right corner</> },
              ].map(({ n, t }) => (
                <div key={n} className="flex items-center gap-3 text-sm text-gray-300">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <Button className="w-full mt-5" onClick={() => setShowIOSGuide(false)}>Got it</Button>
          </div>
        </div>
      )}

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/60 via-background to-background pointer-events-none" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-16 pb-20 lg:pt-24 lg:pb-28">
          <div className="max-w-3xl">
            <Badge variant="secondary" className="mb-5 gap-1.5 text-indigo-300 border-indigo-500/30 bg-indigo-500/10">
              <Zap className="h-3 w-3" /> Trusted by 50,000+ diaspora families worldwide
            </Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] mb-6">
              Your family back home{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                deserves the best
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed mb-8 max-w-2xl">
              RemitFlow is the financial home for the diaspora. Send money home in minutes, invest in your country of origin, save with your community, and support your family — all from one app, at a fraction of what banks charge.
            </p>
            <div className="flex flex-wrap gap-3 mb-8">
              <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
                className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25">
                Start Sending Money Free <ArrowRight className="h-4 w-4" />
              </Button>
              {!isInstalled && isInstallable && (
                <Button size="lg" variant="outline" onClick={handleInstall}
                  className="gap-2 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10">
                  <Download className="h-4 w-4" /> Get the App
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-4">
              {TRUST_BADGES.map(({ icon, label }) => (
                <span key={label} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span className="text-emerald-400">{icon}</span>{label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats Bar ── */}
      <section className="border-y border-border bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {STATS.map(stat => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-extrabold text-foreground mb-1">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Fee Comparison Table ── */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <Badge variant="secondary" className="mb-3 text-emerald-300 border-emerald-500/30 bg-emerald-500/10">
              <DollarSign className="h-3 w-3 mr-1" /> See the savings
            </Badge>
            <h2 className="text-3xl font-bold mb-4">Stop giving your money away in fees</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Every naira saved in fees is a naira that reaches your family. See exactly how much you save by switching to RemitFlow.
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            {/* Currency toggle */}
            <div className="flex rounded-xl border border-border overflow-hidden">
              {(["USD", "NGN"] as const).map(c => (
                <button key={c} onClick={() => setFeeCurrency(c)}
                  className={`px-5 py-2 text-sm font-semibold transition-colors ${feeCurrency === c ? "bg-indigo-600 text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                  {c === "USD" ? "$ USD" : "₦ NGN"}
                </button>
              ))}
            </div>
            {/* Amount selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Sending:</span>
              <div className="flex rounded-xl border border-border overflow-hidden">
                {[100, 250, 500, 1000].map(amt => (
                  <button key={amt} onClick={() => setSendAmount(amt)}
                    className={`px-4 py-2 text-sm font-semibold transition-colors ${sendAmount === amt ? "bg-indigo-600 text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                    ${amt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live rate note */}
          <p className="text-center text-xs text-muted-foreground mb-6">
            Sending {fmtSend()} · Live NGN rate: ₦{ngnRate.toLocaleString("en-NG", { maximumFractionDigits: 0 })} / $1
            {fxRates && <span className="ml-2 text-emerald-400">● Live</span>}
          </p>

          {/* Table */}
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-6 py-4 font-semibold text-foreground">Provider</th>
                  <th className="text-right px-6 py-4 font-semibold text-foreground">Fee on {fmtSend()}</th>
                  <th className="text-right px-6 py-4 font-semibold text-foreground hidden sm:table-cell">Delivery Time</th>
                  <th className="text-right px-6 py-4 font-semibold text-foreground hidden md:table-cell">Exchange Rate</th>
                  <th className="text-right px-6 py-4 font-semibold text-foreground">You Save</th>
                </tr>
              </thead>
              <tbody>
                {feeRows.map((row, i) => {
                  const worstFee = Math.max(...feeRows.map(r => r.feeUSD));
                  const savingUSD = worstFee - row.feeUSD;
                  const savingNGN = savingUSD * ngnRate;
                  return (
                    <tr key={row.provider}
                      className={`border-b border-border last:border-0 transition-colors ${row.highlight ? "bg-indigo-500/5" : "hover:bg-muted/20"}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {row.highlight && <BadgeCheck className="h-4 w-4 text-indigo-400 shrink-0" />}
                          <span className={`font-semibold ${row.highlight ? "text-indigo-300" : "text-foreground"}`}>
                            {row.provider}
                          </span>
                          {row.highlight && <Badge className="text-xs bg-indigo-500/20 text-indigo-300 border-indigo-500/30 ml-1">Best value</Badge>}
                        </div>
                      </td>
                      <td className={`px-6 py-4 text-right font-bold ${row.highlight ? "text-emerald-400" : "text-rose-400"}`}>
                        {fmt(row.feeUSD, row.feeNGN)}
                      </td>
                      <td className="px-6 py-4 text-right text-muted-foreground hidden sm:table-cell">{row.deliveryTime}</td>
                      <td className="px-6 py-4 text-right text-muted-foreground hidden md:table-cell">{row.exchangeRate}</td>
                      <td className="px-6 py-4 text-right">
                        {row.highlight ? (
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : (
                          <span className="text-emerald-400 font-semibold">
                            +{fmt(savingUSD, savingNGN)} more with RemitFlow
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4">
            Fees are estimates based on published rates. Actual fees may vary by payment method and corridor.
          </p>
          <div className="text-center mt-6">
            <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
              className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25">
              Start Saving on Fees Today <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── The Problem We Solve ── */}
      <section className="py-20 bg-muted/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mx-auto text-center mb-14">
            <h2 className="text-3xl font-bold mb-4">You work hard. Your money should work harder.</h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Every year, the diaspora sends over $700 billion home — but banks and money transfer operators take up to 10% in fees. That is money taken from your family. RemitFlow was built to change that.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { icon: <DollarSign className="h-5 w-5 text-rose-400" />, title: "Stop paying high fees", desc: "The average bank charges 6.5% to send money abroad. RemitFlow charges as little as 1.2% — so more of your money reaches your family.", bg: "bg-rose-500/5 border-rose-500/20" },
              { icon: <Clock className="h-5 w-5 text-amber-400" />, title: "Stop waiting 3–5 days", desc: "Bank transfers to Africa can take days. With RemitFlow, most transfers arrive within 2 minutes — day or night, weekday or weekend.", bg: "bg-amber-500/5 border-amber-500/20" },
              { icon: <HomeIcon className="h-5 w-5 text-emerald-400" />, title: "Stay connected to home", desc: "RemitFlow is more than transfers. It is your bridge to home — investments, community savings, family budgets, and local bill payments.", bg: "bg-emerald-500/5 border-emerald-500/20" },
            ].map(item => (
              <div key={item.title} className={`rounded-2xl border p-6 ${item.bg}`}>
                <div className="mb-3">{item.icon}</div>
                <h3 className="font-semibold text-foreground mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <Badge variant="secondary" className="mb-3 text-indigo-300 border-indigo-500/30 bg-indigo-500/10">
              Everything you need
            </Badge>
            <h2 className="text-3xl font-bold mb-4">One app. Every financial need.</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Whether you are sending money home, building wealth, or supporting your community — RemitFlow has you covered.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(f => (
              <div key={f.title}
                className={`rounded-2xl border bg-gradient-to-br p-6 hover:scale-[1.02] transition-transform duration-200 ${f.color}`}>
                <div className={`w-12 h-12 rounded-xl bg-background/50 flex items-center justify-center mb-4 ${f.iconColor}`}>
                  {f.icon}
                </div>
                <h3 className="font-semibold text-foreground mb-2 text-lg">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Popular Corridors ── */}
      <section className="py-20 bg-muted/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-4">Send to any country in Africa</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Choose your destination and see exactly how much your family receives — in local currency, with live rates.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {CORRIDORS.map(c => (
              <Link key={c.country} href={c.route}>
                <div className="group relative rounded-2xl border border-border bg-card p-5 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all cursor-pointer text-center">
                  {/* Hot badge */}
                  {c.hot && (
                    <span className="absolute -top-2 -right-2 flex items-center gap-0.5 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-md">
                      🔥 Hot
                    </span>
                  )}
                  <div className="text-4xl mb-3">{c.flag}</div>
                  <div className="font-semibold text-foreground text-sm mb-1">{c.country}</div>
                  <div className="text-xs text-muted-foreground mb-2">{c.currency}</div>
                  {/* Live transfer count */}
                  <div className="flex items-center justify-center gap-1 text-xs text-emerald-400 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                    {c.todayCount.toLocaleString()} transfers today
                  </div>
                  <div className="flex items-center justify-center gap-1 text-xs text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    See rates <ChevronRight className="h-3 w-3" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold mb-4">Up and running in 5 minutes</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">No bank branch. No long forms. No waiting. Just sign up and start sending.</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.step} className="relative text-center">
                {i < HOW_IT_WORKS.length - 1 && (
                  <div className="hidden sm:block absolute top-6 left-[calc(50%+2rem)] right-[-calc(50%-2rem)] h-px bg-border" />
                )}
                <div className="w-12 h-12 rounded-full bg-indigo-600 text-white font-bold text-lg flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/30">
                  {step.step}
                </div>
                <h3 className="font-semibold text-foreground mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
              className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25">
              Create Your Free Account <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="py-20 bg-muted/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold mb-4">Real stories from the diaspora</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Thousands of families are already using RemitFlow to stay connected and build a better future.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-4">
                <div className="flex gap-0.5">
                  {Array.from({ length: t.stars }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed flex-1">"{t.quote}"</p>
                <div>
                  <div className="font-semibold text-foreground text-sm">{t.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Globe className="h-3 w-3" /> {t.location}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Referral CTA ── */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="rounded-3xl bg-gradient-to-br from-violet-950 to-indigo-950 border border-violet-500/20 p-8 sm:p-12">
            <div className="flex flex-col lg:flex-row items-center gap-8">
              <div className="flex-1 text-center lg:text-left">
                <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/20 border border-violet-500/30 px-4 py-1.5 mb-5">
                  <Gift className="h-4 w-4 text-violet-300" />
                  <span className="text-sm font-semibold text-violet-300">Referral Bonus</span>
                </div>
                <h2 className="text-3xl font-bold text-white mb-4">
                  Invite a friend. Both of you win.
                </h2>
                <p className="text-violet-200 leading-relaxed mb-6 max-w-lg">
                  When you invite a friend to RemitFlow and they send their first transfer, you both receive a bonus — credited directly to your wallet, ready to send home.
                </p>
                <div className="flex flex-wrap gap-6 mb-8 justify-center lg:justify-start">
                  <div className="text-center">
                    <div className="text-3xl font-extrabold text-white">$5</div>
                    <div className="text-sm text-violet-300">You receive</div>
                    <div className="text-xs text-violet-400 mt-0.5">≈ ₦{(5 * ngnRate).toLocaleString("en-NG", { maximumFractionDigits: 0 })}</div>
                  </div>
                  <div className="flex items-center text-violet-500 text-2xl font-bold">+</div>
                  <div className="text-center">
                    <div className="text-3xl font-extrabold text-white">$5</div>
                    <div className="text-sm text-violet-300">Your friend receives</div>
                    <div className="text-xs text-violet-400 mt-0.5">≈ ₦{(5 * ngnRate).toLocaleString("en-NG", { maximumFractionDigits: 0 })}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
                  <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
                    className="gap-2 bg-white text-violet-900 hover:bg-violet-50 font-semibold shadow-xl">
                    <Gift className="h-5 w-5" /> Claim Your Bonus
                  </Button>
                  <Button
                    size="lg"
                    onClick={() => {
                      const msg = encodeURIComponent(
                        `Hey! I use RemitFlow to send money home — it's so much cheaper than the bank. Sign up with my link and we both get $5 free (≈ ₦${(5 * ngnRate).toLocaleString("en-NG", { maximumFractionDigits: 0 })})! 🎉 ${window.location.origin}/referral`
                      );
                      window.open(`https://wa.me/?text=${msg}`, "_blank");
                    }}
                    className="gap-2 bg-[#25D366] hover:bg-[#20c05c] text-white font-semibold shadow-xl"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" xmlns="http://www.w3.org/2000/svg">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    Share on WhatsApp
                  </Button>
                </div>
              </div>
              <div className="shrink-0 grid grid-cols-2 gap-3 max-w-xs">
                {[
                  { icon: <Users className="h-5 w-5 text-violet-400" />, title: "50,000+", sub: "Members referred" },
                  { icon: <DollarSign className="h-5 w-5 text-emerald-400" />, title: "$250K+", sub: "Bonuses paid out" },
                  { icon: <Banknote className="h-5 w-5 text-amber-400" />, title: "No limit", sub: "Refer as many as you like" },
                  { icon: <CheckCircle className="h-5 w-5 text-blue-400" />, title: "Instant", sub: "Bonus credited on first send" },
                ].map(card => (
                  <div key={card.title} className="rounded-2xl bg-white/5 border border-white/10 p-4 text-center">
                    <div className="flex justify-center mb-2">{card.icon}</div>
                    <div className="font-bold text-white text-sm">{card.title}</div>
                    <div className="text-xs text-violet-300 mt-0.5">{card.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PWA Install Section ── */}
      {!isInstalled && (
        <section className="py-20 bg-muted/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="rounded-3xl bg-gradient-to-br from-indigo-950 to-violet-950 border border-indigo-500/20 p-8 sm:p-12 flex flex-col lg:flex-row items-center gap-8">
              <div className="flex-1 text-center lg:text-left">
                <Badge className="mb-4 bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
                  <Smartphone className="h-3 w-3 mr-1" /> Available on all devices
                </Badge>
                <h2 className="text-3xl font-bold text-white mb-4">Take RemitFlow everywhere you go</h2>
                <p className="text-indigo-200 leading-relaxed mb-6 max-w-lg">
                  Install the RemitFlow app on your phone or desktop. It works offline, loads instantly, and sends you alerts when your transfers arrive — just like a native app, with no app store required.
                </p>
                <div className="flex flex-wrap gap-4 justify-center lg:justify-start mb-6">
                  {[
                    { icon: <Zap className="h-4 w-4 text-amber-400" />, label: "Instant loading" },
                    { icon: <Wallet className="h-4 w-4 text-emerald-400" />, label: "Works offline" },
                    { icon: <CheckCircle className="h-4 w-4 text-blue-400" />, label: "Transfer alerts" },
                    { icon: <Lock className="h-4 w-4 text-violet-400" />, label: "Secure & private" },
                  ].map(({ icon, label }) => (
                    <span key={label} className="flex items-center gap-1.5 text-sm text-indigo-200">{icon} {label}</span>
                  ))}
                </div>
                {isInstallable ? (
                  <Button size="lg" onClick={handleInstall}
                    className="gap-2 bg-white text-indigo-900 hover:bg-indigo-50 font-semibold shadow-xl">
                    <Download className="h-5 w-5" />
                    {isIOS ? "Add to Home Screen" : "Install RemitFlow App"}
                  </Button>
                ) : (
                  <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
                    className="gap-2 bg-white text-indigo-900 hover:bg-indigo-50 font-semibold shadow-xl">
                    <ArrowRight className="h-5 w-5" /> Open in Browser
                  </Button>
                )}
              </div>
              <div className="shrink-0 flex flex-col items-center gap-3">
                <img src="/manus-storage/icon-512_41fa5aeb.png" alt="RemitFlow App"
                  className="w-32 h-32 rounded-3xl shadow-2xl shadow-indigo-500/30 border border-indigo-500/20" />
                <div className="text-center">
                  <p className="text-xs text-indigo-300 font-medium">RemitFlow</p>
                  <p className="text-xs text-indigo-400">Free to install</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Final CTA ── */}
      <section className="py-20 bg-gradient-to-b from-background to-indigo-950/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Your family is waiting. Start today.</h2>
          <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
            Join over 50,000 diaspora families who trust RemitFlow to send money home, invest in their roots, and build a better future — together.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
              className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 text-base px-8">
              <Send className="h-4 w-4" /> Send Money Home Now
            </Button>
            <Button size="lg" variant="outline" onClick={() => window.location.href = getLoginUrl()}
              className="gap-2 border-border text-muted-foreground hover:text-foreground text-base px-8">
              <Users className="h-4 w-4" /> Join the Community
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-6">Free to sign up. No monthly fees. No hidden charges.</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <img src="/manus-storage/icon-192_d0405887.png" alt="RemitFlow" className="w-7 h-7 rounded-lg" />
                <span className="font-bold text-sm">RemitFlow</span>
              </div>
              <div className="flex flex-wrap gap-6 text-xs text-muted-foreground justify-center">
                <span>FCA Authorised & Regulated</span>
                <span>GDPR Compliant</span>
                <span>ISO 27001 Certified</span>
                <span>NDIC Insured</span>
              </div>
            </div>
            {/* Corridor links */}
            <div className="border-t border-border pt-6">
              <p className="text-xs text-muted-foreground text-center mb-3 font-medium uppercase tracking-wide">Send money to</p>
              <div className="flex flex-wrap gap-3 justify-center">
                {CORRIDORS.map(c => (
                  <Link key={c.country} href={c.route}>
                    <span className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                      {c.flag} {c.country}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">© 2025 RemitFlow. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
