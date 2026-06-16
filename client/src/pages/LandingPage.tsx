import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ChatWidget } from "@/components/ChatWidget";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowRight, Globe, Shield, Zap, Clock, CheckCircle2, Star, TrendingUp,
  Users, DollarSign, Lock, Award, ChevronDown, Send, Building2, Smartphone,
  BarChart3, RefreshCw, CreditCard, HeartHandshake
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useTranslation } from 'react-i18next';

// ─── Constants ────────────────────────────────────────────────────────────────

const CORRIDORS = [
  { from: "🇺🇸 USD", to: "🇳🇬 NGN", rate: "1,538.40", fee: "$2.99", time: "Minutes", flag: "🇳🇬" },
  { from: "🇬🇧 GBP", to: "🇬🇭 GHS", rate: "15.82", fee: "£1.99", time: "Minutes", flag: "🇬🇭" },
  { from: "🇪🇺 EUR", to: "🇰🇪 KES", rate: "142.50", fee: "€2.49", time: "Minutes", flag: "🇰🇪" },
  { from: "🇨🇦 CAD", to: "🇵🇭 PHP", rate: "41.20", fee: "CA$2.99", time: "Minutes", flag: "🇵🇭" },
  { from: "🇦🇺 AUD", to: "🇮🇳 INR", rate: "54.30", fee: "A$1.99", time: "Minutes", flag: "🇮🇳" },
  { from: "🇺🇸 USD", to: "🇲🇽 MXN", rate: "17.82", fee: "$1.49", time: "Instant", flag: "🇲🇽" },
];

const CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "CAD", symbol: "CA$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
];

const RECEIVE_CURRENCIES = [
  { code: "NGN", rate: 1538.4, name: "Nigerian Naira" },
  { code: "GHS", rate: 15.82, name: "Ghanaian Cedi" },
  { code: "KES", rate: 142.5, name: "Kenyan Shilling" },
  { code: "PHP", rate: 56.2, name: "Philippine Peso" },
  { code: "INR", rate: 83.4, name: "Indian Rupee" },
  { code: "MXN", rate: 17.82, name: "Mexican Peso" },
  { code: "ZAR", rate: 18.6, name: "South African Rand" },
  { code: "EGP", rate: 48.9, name: "Egyptian Pound" },
  { code: "XOF", rate: 655.9, name: "West African CFA Franc" },
  { code: "TZS", rate: 2580, name: "Tanzanian Shilling" },
];

const STATS = [
  { value: "2M+", label: "Transfers Completed", icon: Send },
  { value: "180+", label: "Countries Served", icon: Globe },
  { value: "$4.2B", label: "Total Volume", icon: DollarSign },
  { value: "99.97%", label: "Uptime SLA", icon: TrendingUp },
];

const FEATURES = [
  { icon: Zap, title: "Instant Transfers", description: "Most transfers arrive in minutes, not days. Real-time payment rails for 40+ corridors." },
  { icon: Shield, title: "Bank-Grade Security", description: "256-bit encryption, biometric authentication, and 24/7 fraud monitoring protect every transaction." },
  { icon: TrendingUp, title: "Best Exchange Rates", description: "Live mid-market rates with transparent fees. No hidden charges, ever." },
  { icon: Clock, title: "24/7 Support", description: "Round-the-clock customer support in 12 languages via chat, email, and phone." },
  { icon: Building2, title: "White-Label Ready", description: "Launch your own branded remittance product in days with our partner API." },
  { icon: BarChart3, title: "Compliance Built-In", description: "FCA, FinCEN, and GDPR compliant. Automated AML/KYC screening on every transfer." },
];

const TESTIMONIALS = [
  { name: "Amara Diallo", country: "Senegal → France", rating: 5, text: "RemitFlow is the fastest way I've found to send money home. My family receives funds in minutes and the rates are always competitive." },
  { name: "Carlos Mendez", country: "USA → Mexico", rating: 5, text: "I've tried every remittance app out there. RemitFlow's fees are the lowest and the app is incredibly easy to use." },
  { name: "Priya Sharma", country: "UK → India", rating: 5, text: "The exchange rates are excellent and I love that I can track my transfer in real-time. Highly recommended!" },
];

const TRUST_BADGES = [
  { icon: Award, label: "FCA Regulated", sub: "UK Financial Conduct Authority" },
  { icon: Shield, label: "FinCEN Registered", sub: "US Money Services Business" },
  { icon: Lock, label: "PCI DSS Level 1", sub: "Highest payment security standard" },
  { icon: CheckCircle2, label: "GDPR Compliant", sub: "EU data protection regulation" },
];

// ─── Pricing Calculator ────────────────────────────────────────────────────────

function PricingCalculator() {
  const [amount, setAmount] = useState("500");
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("NGN");

  const numAmount = parseFloat(amount) || 0;
  const receiveInfo = RECEIVE_CURRENCIES.find(c => c.code === toCurrency);
  const fee = numAmount > 0 ? (numAmount < 100 ? 1.99 : numAmount < 500 ? 2.99 : 3.99) : 0;
  const netAmount = numAmount - fee;
  const receiveAmount = receiveInfo ? (netAmount * receiveInfo.rate).toFixed(2) : "0.00";
  const fromInfo = CURRENCIES.find(c => c.code === fromCurrency);

  return (
    <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 max-w-md w-full">
      <h3 className="text-xl font-bold text-gray-900 mb-6">Calculate Your Transfer</h3>

      {/* Send Amount */}
      <div className="mb-4">
        <label className="text-sm font-medium text-gray-600 mb-1 block">You Send</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
              {fromInfo?.symbol}
            </span>
            <Input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="pl-8 text-lg font-semibold border-gray-200 focus:border-violet-500"
              min="1"
            />
          </div>
          <Select value={fromCurrency} onValueChange={setFromCurrency}>
            <SelectTrigger className="w-28 border-gray-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map(c => (
                <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Fee Breakdown */}
      <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-1.5 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Transfer fee</span>
          <span className="font-medium">{fromInfo?.symbol}{fee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Exchange rate</span>
          <span className="font-medium">1 {fromCurrency} = {receiveInfo?.rate.toLocaleString()} {toCurrency}</span>
        </div>
        <div className="border-t border-gray-200 pt-1.5 flex justify-between font-semibold text-gray-900">
          <span>Amount converted</span>
          <span>{fromInfo?.symbol}{netAmount.toFixed(2)}</span>
        </div>
      </div>

      {/* Receive Amount */}
      <div className="mb-6">
        <label className="text-sm font-medium text-gray-600 mb-1 block">Recipient Gets</label>
        <div className="flex gap-2">
          <div className="flex-1 bg-violet-50 border border-violet-200 rounded-md px-3 py-2.5 text-xl font-bold text-violet-700">
            {parseFloat(receiveAmount).toLocaleString()}
          </div>
          <Select value={toCurrency} onValueChange={setToCurrency}>
            <SelectTrigger className="w-28 border-gray-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECEIVE_CURRENCIES.map(c => (
                <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 text-base" asChild>
        <Link href={getLoginUrl("/send")}>
          Send {fromInfo?.symbol}{amount} Now <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>

      <p className="text-center text-xs text-gray-400 mt-3">
        No hidden fees · Rate locked for 15 minutes · Cancel anytime
      </p>
    </div>
  );
}

// ─── Main Landing Page ─────────────────────────────────────────────────────────

export default function LandingPage() {
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const { data: authData, isLoading, isError } = trpc.auth.me.useQuery();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* ── Navigation ── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/95 backdrop-blur-sm shadow-sm" : "bg-transparent"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
                <Send className="h-4 w-4 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">RemitFlow</span>
            </div>

            <div className="hidden md:flex items-center gap-8">
              <a href="#corridors" className="text-sm text-gray-600 hover:text-violet-600 transition-colors">Corridors</a>
              <a href="#features" className="text-sm text-gray-600 hover:text-violet-600 transition-colors">Features</a>
              <a href="#pricing" className="text-sm text-gray-600 hover:text-violet-600 transition-colors">Pricing</a>
              <a href="#partners" className="text-sm text-gray-600 hover:text-violet-600 transition-colors">Partners</a>
            </div>

            <div className="flex items-center gap-3">
              {authData ? (
                <Button asChild className="bg-violet-600 hover:bg-violet-700">
                  <Link href="/dashboard">Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" /></Link>
                </Button>
              ) : (
                <>
                  <Button variant="ghost" className="text-gray-600 hover:text-gray-900" asChild>
                    <a href={getLoginUrl()}>Log In</a>
                  </Button>
                  <Button className="bg-violet-600 hover:bg-violet-700" asChild>
                    <a href={getLoginUrl("/send")}>Get Started</a>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ── */}
      <section className="relative min-h-screen flex items-center overflow-hidden bg-gradient-to-br from-violet-950 via-violet-900 to-indigo-900 pt-16">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-violet-800/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: Copy */}
            <div>
              <Badge className="bg-violet-500/20 text-violet-200 border-violet-500/30 mb-6">
                🌍 Trusted by 2M+ customers in 180+ countries
              </Badge>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6">
                Send Money Home{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-300 to-cyan-300">
                  Instantly
                </span>
              </h1>
              <p className="text-lg text-violet-200 mb-8 max-w-lg">
                The fastest, cheapest, and most secure way to send money across borders.
                Bank-beating exchange rates, transparent fees, and real-time tracking.
              </p>

              <div className="flex flex-wrap gap-4 mb-10">
                <Button size="lg" className="bg-white text-violet-900 hover:bg-violet-50 font-semibold px-8" asChild>
                  <a href={getLoginUrl("/send")}>
                    Start Sending <ArrowRight className="ml-2 h-5 w-5" />
                  </a>
                </Button>
                <Button size="lg" variant="outline" className="border-violet-400 text-violet-200 hover:bg-violet-800/50" asChild>
                  <Link href="/partner/apply">Become a Partner</Link>
                </Button>
              </div>

              {/* Trust indicators */}
              <div className="flex flex-wrap gap-4">
                {[
                  { icon: Shield, text: "FCA Regulated" },
                  { icon: Lock, text: "256-bit Encryption" },
                  { icon: CheckCircle2, text: "No Hidden Fees" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-2 text-violet-300 text-sm">
                    <Icon className="h-4 w-4" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Calculator */}
            <div className="flex justify-center lg:justify-end">
              <PricingCalculator />
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-violet-400 animate-bounce">
          <ChevronDown className="h-6 w-6" />
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="bg-violet-600 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map(({ value, label, icon: Icon }) => (
              <div key={label} className="text-center">
                <Icon className="h-6 w-6 text-violet-200 mx-auto mb-2" />
                <div className="text-3xl font-extrabold text-white">{value}</div>
                <div className="text-sm text-violet-200 mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Live Corridors ── */}
      <section id="corridors" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <Badge className="bg-violet-100 text-violet-700 mb-4">Live Rates</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Top Money Transfer Corridors
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Real-time exchange rates updated every 60 seconds. Competitive rates across 40+ currency pairs.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CORRIDORS.map((corridor) => (
              <Card key={corridor.from + corridor.to} className="hover:shadow-md transition-shadow border-gray-200">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{corridor.flag}</span>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{corridor.from} → {corridor.to}</div>
                        <div className="text-xs text-gray-500">1 unit = {corridor.rate} {corridor.to.split(" ")[1]}</div>
                      </div>
                    </div>
                    <Badge className="bg-green-100 text-green-700 text-xs">
                      <Clock className="h-3 w-3 mr-1" />{corridor.time}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Fee from {corridor.fee}</span>
                    <Button size="sm" variant="outline" className="text-violet-600 border-violet-200 hover:bg-violet-50" asChild>
                      <a href={getLoginUrl("/send")}>Send <ArrowRight className="ml-1 h-3 w-3" /></a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center mt-8">
            <Button variant="outline" className="border-violet-300 text-violet-600 hover:bg-violet-50" asChild>
              <Link href="/fx-rates">View All 180+ Corridors <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <Badge className="bg-violet-100 text-violet-700 mb-4">Why RemitFlow</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Built for the Modern World
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Everything you need to send money globally — fast, secure, and affordable.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="group">
                <div className="w-12 h-12 bg-violet-100 rounded-xl flex items-center justify-center mb-4 group-hover:bg-violet-600 transition-colors">
                  <Icon className="h-6 w-6 text-violet-600 group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing Section ── */}
      <section id="pricing" className="py-20 bg-gradient-to-br from-violet-50 to-indigo-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <Badge className="bg-violet-100 text-violet-700 mb-4">Simple Pricing</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Transparent Fees. No Surprises.
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Flat fees based on transfer amount. No percentage cuts. No hidden charges.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {[
              { range: "Up to $100", fee: "$1.99", highlight: false },
              { range: "$100 – $500", fee: "$2.99", highlight: true },
              { range: "$500+", fee: "$3.99", highlight: false },
            ].map(({ range, fee, highlight }) => (
              <Card key={range} className={`text-center ${highlight ? "border-violet-500 shadow-lg shadow-violet-100" : "border-gray-200"}`}>
                <CardContent className="p-6">
                  {highlight && <Badge className="bg-violet-600 text-white mb-3">Most Popular</Badge>}
                  <div className="text-sm text-gray-500 mb-2">{range}</div>
                  <div className="text-4xl font-extrabold text-gray-900 mb-1">{fee}</div>
                  <div className="text-xs text-gray-400">flat fee per transfer</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            * Business and partner accounts may qualify for volume discounts. <Link href="/partner/apply" className="text-violet-600 hover:underline">Contact us</Link>
          </p>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <Badge className="bg-violet-100 text-violet-700 mb-4">Customer Stories</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Loved by Millions Worldwide
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <Card key={t.name} className="border-gray-200 hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex gap-1 mb-4">
                    {Array.from({ length: t.rating }).map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed mb-4">"{t.text}"</p>
                  <div>
                    <div className="font-semibold text-gray-900 text-sm">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.country}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Partners Section ── */}
      <section id="partners" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <Badge className="bg-violet-100 text-violet-700 mb-4">White-Label API</Badge>
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">
                Launch Your Own Remittance Product
              </h2>
              <p className="text-gray-600 mb-6 leading-relaxed">
                Power your fintech, bank, or neobank with RemitFlow's white-label infrastructure.
                Full API access, custom branding, and dedicated compliance support.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "Full white-label branding — your logo, your colors",
                  "REST + tRPC API with comprehensive documentation",
                  "Dedicated compliance & AML screening",
                  "Revenue sharing on every transaction",
                  "Go live in as little as 2 weeks",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-gray-700">
                    <CheckCircle2 className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button size="lg" className="bg-violet-600 hover:bg-violet-700" asChild>
                <Link href="/partner/apply">
                  Apply as a Partner <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: Smartphone, title: "Mobile SDK", desc: "iOS & Android SDKs for native integration" },
                { icon: Globe, title: "180+ Countries", desc: "Global coverage with local payment methods" },
                { icon: RefreshCw, title: "Real-Time FX", desc: "Live rates updated every 60 seconds" },
                { icon: HeartHandshake, title: "Revenue Share", desc: "Earn on every transaction you process" },
              ].map(({ icon: Icon, title, desc }) => (
                <Card key={title} className="border-gray-200">
                  <CardContent className="p-5">
                    <div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center mb-3">
                      <Icon className="h-5 w-5 text-violet-600" />
                    </div>
                    <div className="font-semibold text-gray-900 text-sm mb-1">{title}</div>
                    <div className="text-xs text-gray-500">{desc}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust Badges ── */}
      <section className="py-16 bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500 mb-8">Regulated, certified, and trusted by industry leaders</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {TRUST_BADGES.map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex flex-col items-center text-center p-4 rounded-xl bg-gray-50">
                <Icon className="h-8 w-8 text-violet-600 mb-2" />
                <div className="font-semibold text-gray-900 text-sm">{label}</div>
                <div className="text-xs text-gray-500 mt-1">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Section ── */}
      <section className="py-20 bg-gradient-to-br from-violet-900 to-indigo-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Ready to Send Money Smarter?
          </h2>
          <p className="text-violet-200 text-lg mb-8 max-w-2xl mx-auto">
            Join 2 million+ customers who trust RemitFlow for fast, affordable international transfers.
            No monthly fees. No minimum balance.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="bg-white text-violet-900 hover:bg-violet-50 font-semibold px-10" asChild>
              <a href={getLoginUrl("/send")}>
                Create Free Account <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
            <Button size="lg" variant="outline" className="border-violet-400 text-violet-200 hover:bg-violet-800/50" asChild>
              <Link href="/partner/apply">Partner With Us</Link>
            </Button>
          </div>
          <p className="text-violet-400 text-sm mt-6">
            Free to sign up · No credit card required · Start in 2 minutes
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-gray-950 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center">
                  <Send className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-white font-bold">RemitFlow</span>
              </div>
              <p className="text-sm leading-relaxed">
                The world's most trusted cross-border remittance platform. Fast, secure, and affordable.
              </p>
            </div>
            {[
              { title: "Product", links: ["Send Money", "Exchange Rates", "Mobile App", "Business API"] },
              { title: "Company", links: ["About Us", "Careers", "Press", "Blog"] },
              { title: "Legal", links: ["Privacy Policy", "Terms of Service", "Cookie Policy", "Compliance"] },
            ].map(({ title, links }) => (
              <div key={title}>
                <h4 className="text-white font-semibold text-sm mb-4">{title}</h4>
                <ul className="space-y-2">
                  {links.map(link => (
                    <li key={link}>
                      <a href="#" className="text-sm hover:text-white transition-colors">{link}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-800 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-xs">© 2026 RemitFlow Ltd. All rights reserved. FCA Registered No. 123456.</p>
            <div className="flex gap-4">
              {["🇬🇧 English", "🇫🇷 Français", "🇪🇸 Español"].map(lang => (
                <button key={lang} className="text-xs hover:text-white transition-colors">{lang}</button>
              ))}
            </div>
          </div>
        </div>
      </footer>

      {/* Floating Support Chat Widget — available to all visitors */}
      <ChatWidget />
    </div>
  );
}
