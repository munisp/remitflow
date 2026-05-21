import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight, Send, CheckCircle, Star, Globe, ShieldCheck,
  Zap, Clock, DollarSign, ChevronLeft, ChevronRight,
  Users, Gift, Banknote, Phone
} from "lucide-react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const CORRIDORS = [
  { flag: "🇳🇬", country: "Nigeria", route: "/send-to-nigeria", currency: "NGN", symbol: "₦" },
  { flag: "🇬🇭", country: "Ghana", route: "/send-to-ghana", currency: "GHS", symbol: "₵" },
  { flag: "🇰🇪", country: "Kenya", route: "/send-to-kenya", currency: "KES", symbol: "KSh" },
  { flag: "🇸🇳", country: "Senegal", route: "/send-to-senegal", currency: "XOF", symbol: "CFA" },
  { flag: "🇨🇲", country: "Cameroon", route: "/send-to-cameroon", currency: "XAF", symbol: "FCFA" },
  { flag: "🇿🇦", country: "South Africa", route: "/send-to-south-africa", currency: "ZAR", symbol: "R" },
  { flag: "🇺🇬", country: "Uganda", route: "/send-to-uganda", currency: "UGX", symbol: "USh" },
  { flag: "🇹🇿", country: "Tanzania", route: "/send-to-tanzania", currency: "TZS", symbol: "TSh" },
];

const TESTIMONIALS = [
  {
    name: "Adaeze O.",
    location: "London → Lagos",
    quote: "I used to pay £25 every time I sent money home. With RemitFlow, I pay less than £3 and my mum gets it the same day.",
    stars: 5,
  },
  {
    name: "Kwame A.",
    location: "Manchester → Accra",
    quote: "Set up automatic monthly transfers so my family never goes without. RemitFlow just works — no stress, no delays.",
    stars: 5,
  },
  {
    name: "Fatima D.",
    location: "Birmingham → Dakar",
    quote: "Our community savings group uses RemitFlow to pool money for investments back home. It is simple and the fees are very low.",
    stars: 5,
  },
];

export default function DiasporaUK() {
  const { t } = useTranslation();
  const { data: fxRates, isLoading, isError } = trpc.fx.rates.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const ngnRate = fxRates?.find(r => r.currency === "NGN")?.rate ?? 1540;
  const gbpRate = fxRates?.find(r => r.currency === "GBP")?.rate ?? 0.79;

  // GBP to NGN: 1 GBP = (1/gbpRate) USD * ngnRate
  const gbpToNgn = (1 / gbpRate) * ngnRate;

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
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-16 pb-20 lg:pt-24 lg:pb-28">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-5">
              <span className="text-5xl">🇬🇧</span>
              <Badge variant="secondary" className="text-indigo-300 border-indigo-500/30 bg-indigo-500/10">
                <Zap className="h-3 w-3 mr-1" /> Built for the UK African diaspora
              </Badge>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] mb-6">
              The financial home for{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                Africans in the UK
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed mb-8 max-w-2xl">
              Whether you are in London, Manchester, Birmingham, or Leeds — RemitFlow helps you send money home to Africa, invest in your country of origin, and support your family, all from one app. Pay up to 5x less than your bank charges.
            </p>
            <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
              className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25">
              Start Sending from the UK <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── Live GBP/NGN Rate ── */}
      <section className="py-12 border-y border-border bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="rounded-2xl bg-card border border-border p-6 text-center">
              <p className="text-sm text-muted-foreground mb-1">£1 GBP in naira today</p>
              <p className="text-3xl font-extrabold text-foreground">
                ₦{gbpToNgn.toLocaleString("en-NG", { maximumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-emerald-400 mt-1 flex items-center justify-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                {fxRates ? "Live rate" : "Loading..."}
              </p>
            </div>
            <div className="rounded-2xl bg-card border border-border p-6 text-center">
              <p className="text-sm text-muted-foreground mb-1">RemitFlow fee</p>
              <p className="text-3xl font-extrabold text-emerald-400">1.2%</p>
              <p className="text-xs text-muted-foreground mt-1">vs 6.5% at UK banks</p>
            </div>
            <div className="rounded-2xl bg-card border border-border p-6 text-center">
              <p className="text-sm text-muted-foreground mb-1">Delivery time</p>
              <p className="text-3xl font-extrabold text-foreground">~2 min</p>
              <p className="text-xs text-muted-foreground mt-1">To Nigeria, Ghana, Kenya & more</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── GBP → NGN Calculator ── */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">How much does £500 send to Nigeria?</h2>
            <p className="text-muted-foreground">See exactly what your family receives — in naira, at the live rate, after fees.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {[100, 250, 500, 1000].map(gbp => {
              const usd = gbp / gbpRate;
              const fee = usd * 0.012;
              const afterFee = usd - fee;
              const ngn = afterFee * ngnRate;
              return (
                <DashboardLayout>
                <div key={gbp} className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5 text-center">
                  <div className="text-sm text-muted-foreground mb-1">You send</div>
                  <div className="text-2xl font-extrabold text-foreground mb-3">£{gbp}</div>
                  <div className="text-xs text-muted-foreground mb-1">Fee: £{(gbp * 0.012).toFixed(2)}</div>
                  <div className="border-t border-border my-2" />
                  <div className="text-sm text-muted-foreground mb-0.5">Family receives</div>
                  <div className="text-xl font-bold text-emerald-400">
                    ₦{ngn.toLocaleString("en-NG", { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">≈ ${usd.toFixed(0)} USD</div>
                </div>
              
                </DashboardLayout>
              );
            })}
          </div>
          <div className="text-center mt-8">
            <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
              className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white">
              <Send className="h-4 w-4" /> Send from the UK Now
            </Button>
          </div>
        </div>
      </section>

      {/* ── Choose Your Destination ── */}
      <section className="py-16 bg-muted/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">Where are you sending to?</h2>
            <p className="text-muted-foreground">Choose your destination to see live rates, fees, and payment methods.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {CORRIDORS.map(c => (
              <Link key={c.country} href={c.route}>
                <div className="group rounded-2xl border border-border bg-card p-5 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all cursor-pointer text-center">
                  <div className="text-4xl mb-3">{c.flag}</div>
                  <div className="font-semibold text-foreground text-sm mb-1">{c.country}</div>
                  <div className="text-xs text-muted-foreground mb-2">{c.currency}</div>
                  <div className="flex items-center justify-center gap-1 text-xs text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    See rates <ChevronRight className="h-3 w-3" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why UK Diaspora Chooses RemitFlow ── */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">Why Africans in the UK choose RemitFlow</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: <DollarSign className="h-5 w-5 text-emerald-400" />, title: "Pay 5x less in fees", desc: "UK banks charge up to 6.5%. RemitFlow charges as little as 1.2% — so more of your pounds reach your family." },
              { icon: <Zap className="h-5 w-5 text-amber-400" />, title: "Arrives in minutes", desc: "Most transfers to Africa arrive within 2 minutes — day or night, weekday or weekend." },
              { icon: <ShieldCheck className="h-5 w-5 text-blue-400" />, title: "FCA Authorised", desc: "RemitFlow is fully authorised by the UK Financial Conduct Authority. Your money is safe and protected." },
              { icon: <Users className="h-5 w-5 text-violet-400" />, title: "Community savings", desc: "Start or join a savings group with friends and family — just like the ajo or susu you know from home." },
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

      {/* ── Testimonials ── */}
      <section className="py-16 bg-muted/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">What UK diaspora families say</h2>
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
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="rounded-3xl bg-gradient-to-br from-violet-950 to-indigo-950 border border-violet-500/20 p-8 sm:p-12 text-center">
            <Gift className="h-10 w-10 text-violet-300 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white mb-4">Invite a friend. Both of you win.</h2>
            <p className="text-violet-200 leading-relaxed mb-6 max-w-lg mx-auto">
              When you invite a friend in the UK to RemitFlow and they send their first transfer, you both receive a £4 bonus — credited to your wallet, ready to send home.
            </p>
            <div className="flex gap-6 justify-center mb-8">
              <div className="text-center">
                <div className="text-3xl font-extrabold text-white">£4</div>
                <div className="text-sm text-violet-300">You receive</div>
                <div className="text-xs text-violet-400 mt-0.5">≈ ₦{(4 / gbpRate * ngnRate).toLocaleString("en-NG", { maximumFractionDigits: 0 })}</div>
              </div>
              <div className="flex items-center text-violet-500 text-2xl font-bold">+</div>
              <div className="text-center">
                <div className="text-3xl font-extrabold text-white">£4</div>
                <div className="text-sm text-violet-300">Your friend receives</div>
                <div className="text-xs text-violet-400 mt-0.5">≈ ₦{(4 / gbpRate * ngnRate).toLocaleString("en-NG", { maximumFractionDigits: 0 })}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 justify-center">
              <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
                className="gap-2 bg-white text-violet-900 hover:bg-violet-50 font-semibold shadow-xl">
                <Gift className="h-5 w-5" /> Claim Your Bonus
              </Button>
              <Button
                size="lg"
                onClick={() => {
                  const gbpNgnAmt = Math.round(4 / gbpRate * ngnRate).toLocaleString("en-NG");
                  const msg = encodeURIComponent(
                    `Hey! I use RemitFlow to send money home from the UK — it's so much cheaper than the bank. Sign up with my link and we both get £4 free (≈ ₦${gbpNgnAmt})! 🎉 ${window.location.origin}/referral`
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
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 bg-gradient-to-b from-background to-indigo-950/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Start sending from the UK today</h2>
          <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
            Join thousands of Africans in the UK who trust RemitFlow to keep their families connected and supported.
          </p>
          <Button size="lg" onClick={() => window.location.href = getLoginUrl()}
            className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 text-base px-8">
            <Send className="h-4 w-4" /> Create Your Free Account
          </Button>
          <p className="text-xs text-muted-foreground mt-4">No monthly fees. No hidden charges. FCA Authorised.</p>
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
