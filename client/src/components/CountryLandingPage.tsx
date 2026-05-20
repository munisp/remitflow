/**
 * CountryLandingPage — reusable template for corridor-specific landing pages.
 * Each country page passes its own config; live FX rates are fetched via tRPC.
 */
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { SendMoneyWidget } from "@/components/SendMoneyWidget";
import {
  ArrowRight, Send, CheckCircle, Star, Globe, ShieldCheck,
  Zap, Clock, DollarSign, Banknote, Phone, CreditCard,
  ChevronLeft, ChevronRight, BadgeCheck, Users, Gift
} from "lucide-react";

export interface CorridorConfig {
  flag: string;
  country: string;
  currency: string;        // e.g. "NGN"
  currencySymbol: string;  // e.g. "₦"
  language: string;        // e.g. "English, Yoruba, Igbo, Hausa"
  population: string;      // diaspora population abroad
  paymentMethods: string[];
  popularAmountsUSD: number[];
  mobileMoneyProvider?: string;
  bankName?: string;
  cashPickup?: string;
  heroTagline: string;
  heroSubtitle: string;
  testimonial: { name: string; from: string; quote: string };
  faqs: { q: string; a: string }[];
  relatedCorridors: { flag: string; country: string; route: string }[];
}

interface Props {
  config: CorridorConfig;
}

export function CountryLandingPage({ config }: Props) {
  const { data: fxRates } = trpc.fx.rates.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const usdToLocal = fxRates?.find(r => r.currency === config.currency)?.rate ?? 1;
  const usdToNgn = fxRates?.find(r => r.currency === "NGN")?.rate ?? 1540;

  const fmtLocal = (usd: number) =>
    `${config.currencySymbol}${(usd * usdToLocal).toLocaleString("en", { maximumFractionDigits: 0 })}`;

  const fmtNgn = (usd: number) =>
    `₦${(usd * usdToNgn).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            </Link>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-2">
              <img src="/manus-storage/icon-192_d0405887.png" alt="RemitFlow" className="w-7 h-7 rounded-lg" />
              <span className="font-bold text-base">RemitFlow</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => window.location.href = getLoginUrl()}>Sign In</Button>
            <Button size="sm" onClick={() => window.location.href = getLoginUrl()} className="gap-1.5">
              Start Free <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/60 via-background to-background pointer-events-none" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-16 pb-20 lg:pt-24 lg:pb-28">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: copy */}
            <div>
              <div className="flex items-center gap-3 mb-5">
                <span className="text-5xl">{config.flag}</span>
                <Badge variant="secondary" className="text-indigo-300 border-indigo-500/30 bg-indigo-500/10">
                  <Zap className="h-3 w-3 mr-1" /> Live rates updated every 5 minutes
                </Badge>
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.1] mb-6">
                {config.heroTagline}
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed mb-6 max-w-xl">
                {config.heroSubtitle}
              </p>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                {["FCA Regulated", "Bank-Grade Security", "150+ Countries", "24/7 Support"].map(t => (
                  <span key={t} className="flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4 text-emerald-400" /> {t}
                  </span>
                ))}
              </div>
            </div>
            {/* Right: live widget */}
            <div>
              <SendMoneyWidget
                toCurrency={config.currency}
                toSymbol={config.currencySymbol}
                toCountry={config.country}
                toFlag={config.flag}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Live Rate Card ── */}
      <section className="py-12 border-y border-border bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="rounded-2xl bg-card border border-border p-6 text-center">
              <p className="text-sm text-muted-foreground mb-1">Live exchange rate</p>
              <p className="text-3xl font-extrabold text-foreground">
                $1 = {config.currencySymbol}{usdToLocal.toLocaleString("en", { maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-emerald-400 mt-1 flex items-center justify-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                {fxRates ? "Live rate" : "Loading..."}
              </p>
            </div>
            <div className="rounded-2xl bg-card border border-border p-6 text-center">
              <p className="text-sm text-muted-foreground mb-1">RemitFlow fee</p>
              <p className="text-3xl font-extrabold text-emerald-400">1.2%</p>
              <p className="text-xs text-muted-foreground mt-1">vs 6.5% at most banks</p>
            </div>
            <div className="rounded-2xl bg-card border border-border p-6 text-center">
              <p className="text-sm text-muted-foreground mb-1">Delivery time</p>
              <p className="text-3xl font-extrabold text-foreground">~2 min</p>
              <p className="text-xs text-muted-foreground mt-1">Most transfers arrive instantly</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Amount Reference Cards ── */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">Quick reference — popular amounts</h2>
            <p className="text-muted-foreground">See what common transfer amounts look like at today's live rate.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {config.popularAmountsUSD.map(amt => {
              const fee = amt * 0.012;
              const afterFee = amt - fee;
              const localAmt = afterFee * usdToLocal;
              const ngnAmt = afterFee * usdToNgn;
              return (
                <div key={amt} className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5 text-center hover:border-indigo-500/40 transition-colors">
                  <div className="text-sm text-muted-foreground mb-1">You send</div>
                  <div className="text-2xl font-extrabold text-foreground mb-3">${amt}</div>
                  <div className="text-xs text-muted-foreground mb-1">Fee: ${fee.toFixed(2)}</div>
                  <div className="border-t border-border my-2" />
                  <div className="text-sm text-muted-foreground mb-0.5">They receive</div>
                  <div className="text-xl font-bold text-emerald-400">
                    {config.currencySymbol}{localAmt.toLocaleString("en", { maximumFractionDigits: 0 })}
                  </div>
                  {config.currency !== "NGN" && (
                    <div className="text-xs text-muted-foreground mt-1">≈ ₦{ngnAmt.toLocaleString("en-NG", { maximumFractionDigits: 0 })}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Payment Methods ── */}
      <section className="py-16 bg-muted/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">How does your family receive the money?</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              We support all the ways people in {config.country} prefer to receive money.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl mx-auto">
            {config.paymentMethods.map(method => (
              <div key={method} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
                <span className="text-sm font-medium text-foreground">{method}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonial ── */}
      <section className="py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="rounded-3xl bg-gradient-to-br from-indigo-950 to-violet-950 border border-indigo-500/20 p-8 text-center">
            <div className="flex justify-center gap-0.5 mb-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <p className="text-lg text-indigo-100 leading-relaxed mb-6 italic">
              "{config.testimonial.quote}"
            </p>
            <div>
              <div className="font-semibold text-white">{config.testimonial.name}</div>
              <div className="text-sm text-indigo-300 flex items-center justify-center gap-1 mt-1">
                <Globe className="h-3.5 w-3.5" /> {config.testimonial.from}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Why RemitFlow ── */}
      <section className="py-16 bg-muted/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">Why thousands choose RemitFlow to send to {config.country}</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: <DollarSign className="h-5 w-5 text-emerald-400" />, title: "Lowest fees", desc: "As little as 1.2% — far below banks and traditional money transfer services." },
              { icon: <Zap className="h-5 w-5 text-amber-400" />, title: "Arrives in minutes", desc: "Most transfers to " + config.country + " are delivered within 2 minutes, 24/7." },
              { icon: <ShieldCheck className="h-5 w-5 text-blue-400" />, title: "Safe & regulated", desc: "FCA authorised. Your money is protected and fully insured at every step." },
              { icon: <Phone className="h-5 w-5 text-violet-400" />, title: "Works on any phone", desc: "Send from your phone, tablet, or computer. No app download required." },
            ].map(item => (
              <div key={item.title} className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-3">{item.icon}</div>
                <h3 className="font-semibold text-foreground mb-1.5">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQs ── */}
      <section className="py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="text-3xl font-bold text-center mb-10">Frequently asked questions</h2>
          <div className="space-y-4">
            {config.faqs.map(faq => (
              <div key={faq.q} className="rounded-2xl border border-border bg-card p-6">
                <h3 className="font-semibold text-foreground mb-2">{faq.q}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Related Corridors ── */}
      <section className="py-16 bg-muted/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-center mb-8">Also sending to another country?</h2>
          <div className="flex flex-wrap gap-3 justify-center">
            {config.relatedCorridors.map(c => (
              <Link key={c.country} href={c.route}>
                <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all cursor-pointer">
                  <span className="text-xl">{c.flag}</span>
                  <span className="text-sm font-medium text-foreground">{c.country}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 bg-gradient-to-b from-background to-indigo-950/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Ready to send to {config.country}?
          </h2>
          <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
            Create your free account in 2 minutes and send your first transfer today. No hidden fees. No surprises.
          </p>
          <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
            className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 text-base px-8">
            <Send className="h-4 w-4" /> Send to {config.country} — Free to Start
          </Button>
          <p className="text-xs text-muted-foreground mt-4">No monthly fees. No hidden charges. Cancel anytime.</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/manus-storage/icon-192_d0405887.png" alt="RemitFlow" className="w-6 h-6 rounded" />
            <span className="font-bold text-sm">RemitFlow</span>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground justify-center">
            <span>FCA Authorised</span><span>GDPR Compliant</span><span>ISO 27001</span>
          </div>
          <p className="text-xs text-muted-foreground">© 2025 RemitFlow. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
