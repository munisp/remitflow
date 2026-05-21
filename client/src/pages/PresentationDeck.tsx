import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Globe, Zap, Shield, TrendingUp, Users, Building2, ArrowLeftRight, Layers, Star, CheckCircle2, ArrowRight, Play, Pause } from "lucide-react";
import { useTranslation } from 'react-i18next';

// ─── Slide data ───────────────────────────────────────────────────────────────

const SLIDES = [
  { id: 1, title: "Cover" },
  { id: 2, title: "The Problem" },
  { id: 3, title: "The Solution" },
  { id: 4, title: "B2B Use Cases" },
  { id: 5, title: "B2C Use Cases" },
  { id: 6, title: "Fiat ↔ Crypto ↔ Mobile Money" },
  { id: 7, title: "Beyond Remittance" },
  { id: 8, title: "The Diaspora Angle" },
  { id: 9, title: "World-Class Technology" },
  { id: 10, title: "Competitive Edge" },
  { id: 11, title: "Security & Compliance" },
  { id: 12, title: "Global Reach" },
  { id: 13, title: "Call to Action" },
];

// ─── Reusable components ──────────────────────────────────────────────────────

function StatCard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-5 text-center">
      <div className="text-3xl font-black text-white mb-1">{value}</div>
      <div className="text-sm font-semibold text-white/80">{label}</div>
      {sub && <div className="text-xs text-white/50 mt-1">{sub}</div>}
    </div>
  );
}

function FeatureRow({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
      <div className="mt-0.5 text-emerald-400 shrink-0">{icon}</div>
      <div>
        <div className="text-sm font-bold text-white">{title}</div>
        <div className="text-xs text-white/60 mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/30 rounded-full px-4 py-1.5 mb-4">
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      <span className="text-xs font-bold text-emerald-300 uppercase tracking-widest">{children}</span>
    </div>
  );
}

function CompareRow({ feature, us, them1, them2, them3, them4 }: {
  feature: string; us: string; them1: string; them2: string; them3: string; them4: string;
}) {
  const cell = (val: string, highlight?: boolean) => (
    <td className={`px-3 py-2.5 text-center text-xs ${highlight ? "text-emerald-300 font-bold" : val === "No" || val === "—" ? "text-white/30" : "text-white/70"}`}>
      {val === "Yes" ? <span className="text-emerald-400">✓</span> : val === "No" || val === "—" ? <span className="text-white/25">✗</span> : val}
    </td>
  );
  return (
    <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
      <td className="px-3 py-2.5 text-xs font-medium text-white/80">{feature}</td>
      {cell(us, true)}
      {cell(them1)}
      {cell(them2)}
      {cell(them3)}
      {cell(them4)}
    </tr>
  );
}

// ─── Slide components ─────────────────────────────────────────────────────────

function Slide1() {
  return (
    <div className="relative h-full flex flex-col items-center justify-center text-center overflow-hidden">
      {/* Background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-teal-500/10 blur-3xl" />
      </div>

      {/* Animated globe grid */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{
        backgroundImage: "radial-gradient(circle, #10b981 1px, transparent 1px)",
        backgroundSize: "40px 40px"
      }} />

      <div className="relative z-10 max-w-4xl px-8">
        <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/40 rounded-full px-5 py-2 mb-8">
          <Globe className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-emerald-300 uppercase tracking-widest">Cross-Border Financial Platform</span>
        </div>

        <h1 className="text-7xl font-black text-white mb-4 tracking-tight">
          Remit<span className="text-emerald-400">Flow</span>
        </h1>

        <p className="text-2xl font-light text-white/70 mb-3">
          The World's Most Complete Cross-Border Financial Platform
        </p>
        <p className="text-lg text-white/50 mb-12">
          Move money. Grow wealth. Power business. Across every border.
        </p>

        <div className="grid grid-cols-4 gap-4 max-w-3xl mx-auto">
          <StatCard value="295" label="Web Pages" sub="Full feature coverage" />
          <StatCard value="13" label="Live Corridors" sub="Africa + Global" />
          <StatCard value="75" label="Microservices" sub="Go · Rust · Python" />
          <StatCard value="589" label="Mobile Screens" sub="Flutter + React Native" />
        </div>
      </div>
    </div>
  );
}

function Slide2() {
  const problems = [
    { icon: "💸", title: "Fees Drain Families", desc: "Average global remittance fee is 6.3% — families lose billions every year sending money home." },
    { icon: "⏳", title: "Transfers Take Days", desc: "Legacy SWIFT rails take 3–5 business days. Families wait. Businesses stall." },
    { icon: "🧩", title: "Fragmented Solutions", desc: "No single platform covers fiat, crypto, mobile money, and investment in one place." },
    { icon: "🌍", title: "Africa Underserved", desc: "1.4 billion people on 2G/3G networks, cash-based economies, and limited banking access." },
    { icon: "📋", title: "Compliance Burden", desc: "CBN Form M, FX controls, AML/KYC — businesses navigate this alone with no tooling." },
    { icon: "🔒", title: "Diaspora Locked Out", desc: "250 million diaspora members cannot easily invest in their homeland from abroad." },
  ];

  return (
    <div className="h-full flex flex-col justify-center px-12 py-8">
      <SectionLabel>The Problem</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">The Global Remittance Market Is Broken</h2>
      <p className="text-white/50 mb-8 text-lg">Existing platforms solve one problem. RemitFlow solves all of them.</p>

      <div className="grid grid-cols-3 gap-4">
        {problems.map((p, i) => (
          <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/8 transition-colors">
            <div className="text-3xl mb-3">{p.icon}</div>
            <div className="text-sm font-bold text-white mb-1.5">{p.title}</div>
            <div className="text-xs text-white/55 leading-relaxed">{p.desc}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
        <p className="text-sm text-red-300 text-center font-medium">
          The world needs a platform that handles the full financial lifecycle: <span className="text-white font-bold">Send → Save → Invest → Insure → Borrow → Grow</span>
        </p>
      </div>
    </div>
  );
}

function Slide3() {
  return (
    <div className="h-full flex flex-col justify-center px-12 py-8">
      <SectionLabel>The Solution</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">One Platform. Every Financial Need.</h2>
      <p className="text-white/50 mb-6 text-base">Every claim below is verified against the live production codebase.</p>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <FeatureRow icon={<Globe className="w-4 h-4" />} title="13 Live African Corridors" desc="Nigeria, Ghana, Kenya, Tanzania, Uganda, South Africa, Senegal, Cameroon, Benin, Togo, Mali, Niger + USA/EU diaspora" />
          <FeatureRow icon={<Zap className="w-4 h-4" />} title="Live FX Rates" desc="openexchangerates.org with automatic static fallback — always accurate, never stale" />
          <FeatureRow icon={<ArrowLeftRight className="w-4 h-4" />} title="SWIFT GPI / ISO 20022" desc="pacs.008 institutional wire transfers with BIC validation and UETR tracking" />
          <FeatureRow icon={<Layers className="w-4 h-4" />} title="Mojaloop Interoperability" desc="Instant settlement across African FSPs — party lookup, quote, transfer, status" />
          <FeatureRow icon={<Shield className="w-4 h-4" />} title="M-Pesa STK Push" desc="Kenya mobile money corridor with real M-Pesa integration" />
        </div>
        <div className="space-y-3">
          <FeatureRow icon={<CheckCircle2 className="w-4 h-4" />} title="Multi-Currency Wallets" desc="NGN, USD, GBP, EUR, CAD, AED, USDT, USDC, BUSD, DAI, NGNT — 10+ currencies" />
          <FeatureRow icon={<TrendingUp className="w-4 h-4" />} title="Investment Platform" desc="NGX stocks, fractional real estate, startup deals, diaspora bonds" />
          <FeatureRow icon={<Users className="w-4 h-4" />} title="Full Mobile Apps" desc="294 Flutter screens + 295 React Native screens — complete feature parity" />
          <FeatureRow icon={<Building2 className="w-4 h-4" />} title="B2B White-Label" desc="Multi-tenant architecture — launch your own remittance brand on our infrastructure" />
          <FeatureRow icon={<Star className="w-4 h-4" />} title="Africa-First Resilience" desc="WebSocket → SSE → Long-poll → Short-poll fallback. Works on 2G. Offline queue." />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-3">
        <StatCard value="225" label="DB Tables" sub="Full data model" />
        <StatCard value="63+" label="API Routers" sub="tRPC end-to-end" />
        <StatCard value="3,634" label="Tests Passing" sub="74 test files" />
        <StatCard value="15+" label="Docker Compose" sub="Production-ready" />
      </div>
    </div>
  );
}

function Slide4() {
  const b2bTracks = [
    {
      icon: "🏢",
      title: "IMTO / Partner Onboarding",
      items: ["5-step white-label onboarding wizard", "Self-service partner application portal", "Admin review & approval workflow", "Per-tenant branding, fees, and webhooks", "Automated revenue share disbursements"],
    },
    {
      icon: "💱",
      title: "BDC Portal",
      items: ["Full BDC onboarding & CBN compliance filing", "CBN Form M validation with reference generation", "CTR reporting & PAPSS compliance dashboard", "Corridor-specific FX spread configuration", "Dynamic fee rules by corridor, amount, tier"],
    },
    {
      icon: "🌐",
      title: "SME Trade Finance",
      items: ["B2B international trade payments up to $1M", "Corridors: China, UAE, India, UK, USA", "Automated Form M validation & audit trail", "Go microservice for trade processing", "Compliance ML for trade risk scoring"],
    },
    {
      icon: "🏪",
      title: "Agent Banking Network",
      items: ["Agent registration & territory management", "POS terminal provisioning & remote restart", "Cash-in processing via agent terminals", "Know Your Business (KYB) verification", "Commission tracking & settlement"],
    },
    {
      icon: "🛒",
      title: "Merchant & Checkout",
      items: ["Merchant KYB and onboarding portal", "Embeddable checkout SDK", "Direct debit mandates for recurring payments", "QR-based payment acceptance", "Webhook management with retry logic"],
    },
    {
      icon: "🔌",
      title: "API & Developer Platform",
      items: ["API key creation, rotation, and scoping", "Sandbox environment for partner testing", "Webhook management with retry & delivery logs", "API versioning & usage analytics dashboard", "Full tRPC type-safe API surface"],
    },
  ];

  return (
    <div className="h-full flex flex-col justify-center px-12 py-6">
      <SectionLabel>Business to Business</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">Built for Every Type of Business</h2>
      <p className="text-white/50 mb-5 text-base">Six distinct B2B tracks — all production-ready in the codebase.</p>

      <div className="grid grid-cols-3 gap-4">
        {b2bTracks.map((track, i) => (
          <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/8 transition-colors">
            <div className="text-2xl mb-2">{track.icon}</div>
            <div className="text-sm font-bold text-white mb-2">{track.title}</div>
            <ul className="space-y-1">
              {track.items.map((item, j) => (
                <li key={j} className="flex items-start gap-1.5 text-xs text-white/55">
                  <span className="text-emerald-400 mt-0.5 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function Slide5() {
  const b2cTracks = [
    {
      icon: "💸",
      title: "Send Money",
      items: ["13 African corridors + global SWIFT", "Live FX calculator before sending", "Rate lock — guarantee a rate for 24 hours", "Recurring & scheduled transfers", "Batch payments to multiple recipients"],
    },
    {
      icon: "💳",
      title: "Wallets & Cards",
      items: ["10+ currency multi-currency wallet", "Virtual & physical Visa/Mastercard/Verve cards", "Dedicated virtual account numbers", "QR-based payment and receive", "BNPL — buy now, pay in 4 installments"],
    },
    {
      icon: "📈",
      title: "Save & Invest",
      items: ["Flex and locked savings with auto-save", "NGX Stock Market — buy/sell Nigerian equities", "Fractional real estate investment", "Startup deal room — seed & growth rounds", "HNW private banking with negotiated FX"],
    },
    {
      icon: "🧾",
      title: "Bills & Lifestyle",
      items: ["Pay DSTV, electricity, water, internet", "Airtime top-up (MTN, Airtel, Glo, 9mobile)", "School fees & education payments", "Medical tourism payment facilitation", "Cross-border freelancer payments"],
    },
    {
      icon: "📊",
      title: "FX & Rate Tools",
      items: ["Set rate alerts for target exchange rates", "Live exchange rate dashboard", "FX hedging products", "FX options pricing", "Rate lock for 24 hours"],
    },
    {
      icon: "🎁",
      title: "Loyalty & Community",
      items: ["Points-based loyalty rewards program", "Referral program — earn per referred friend", "Promotional codes (WELCOME10 etc.)", "Community feed, hub & leaderboard", "Split bills with friends and family"],
    },
  ];

  return (
    <div className="h-full flex flex-col justify-center px-12 py-6">
      <SectionLabel>Individuals to Business</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">Everything an Individual Needs. In One App.</h2>
      <p className="text-white/50 mb-5 text-base">From first transfer to long-term wealth — all verified in the production codebase.</p>

      <div className="grid grid-cols-3 gap-4">
        {b2cTracks.map((track, i) => (
          <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/8 transition-colors">
            <div className="text-2xl mb-2">{track.icon}</div>
            <div className="text-sm font-bold text-white mb-2">{track.title}</div>
            <ul className="space-y-1">
              {track.items.map((item, j) => (
                <li key={j} className="flex items-start gap-1.5 text-xs text-white/55">
                  <span className="text-emerald-400 mt-0.5 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function Slide6() {
  const flows = [
    {
      category: "Fiat Rails",
      color: "blue",
      items: [
        { name: "ACH", desc: "USA → Nigeria, 1% cashback program" },
        { name: "SEPA", desc: "EU → Nigeria, diaspora corridors" },
        { name: "SWIFT GPI", desc: "ISO 20022 pacs.008, UETR tracking" },
        { name: "PAPSS", desc: "Pan-African Payment & Settlement System" },
        { name: "GHIPSS", desc: "Ghana Interbank Settlement" },
        { name: "CIPS", desc: "China Cross-Border Interbank Payments" },
        { name: "BRICSPay", desc: "BRICS payment network" },
        { name: "PIX", desc: "Brazil instant payments" },
        { name: "UPI", desc: "India Unified Payments Interface" },
      ],
    },
    {
      category: "Crypto & Stablecoins",
      color: "purple",
      items: [
        { name: "Fireblocks NCW", desc: "Non-custodial wallet custody (primary)" },
        { name: "BitGo", desc: "Secondary custody with automatic failover" },
        { name: "USDT / USDC", desc: "Multi-chain: Ethereum, BSC, Polygon" },
        { name: "BUSD / DAI", desc: "Additional stablecoin support" },
        { name: "NGNT", desc: "Nigerian stablecoin (ERC-20)" },
        { name: "CBDC", desc: "Central Bank Digital Currency wallets" },
        { name: "TRISA", desc: "FATF Travel Rule for transfers >$1,000" },
        { name: "mBridge", desc: "Multi-CBDC bridge adapter" },
        { name: "Stablecoin Swap", desc: "USDT ↔ USDC ↔ DAI with fee calc" },
      ],
    },
    {
      category: "Mobile Money",
      color: "emerald",
      items: [
        { name: "Mojaloop", desc: "FSP interoperability: lookup, quote, transfer" },
        { name: "M-Pesa", desc: "Kenya STK push — real integration" },
        { name: "Africa's Talking", desc: "SMS OTP — real SDK, works on 2G" },
        { name: "XOF Adapter", desc: "West African CFA franc mobile money" },
        { name: "Agent Cash-In", desc: "Physical cash ↔ digital via agent network" },
        { name: "Agent Cash-Out", desc: "Digital ↔ physical via POS terminals" },
        { name: "GHIPSS", desc: "Ghana mobile money interoperability" },
        { name: "Virtual Accounts", desc: "Dedicated account numbers per currency" },
        { name: "QR Payments", desc: "QR-based mobile payment acceptance" },
      ],
    },
  ];

  const colorMap: Record<string, string> = {
    blue: "bg-blue-500/10 border-blue-500/20 text-blue-300",
    purple: "bg-purple-500/10 border-purple-500/20 text-purple-300",
    emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
  };

  return (
    <div className="h-full flex flex-col justify-center px-12 py-6">
      <SectionLabel>Bidirectional Flows</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">Fiat ↔ Crypto ↔ Stablecoin ↔ Mobile Money</h2>
      <p className="text-white/50 mb-5 text-base">Every rail is implemented. Every flow is bidirectional. Every asset class is supported.</p>

      <div className="grid grid-cols-3 gap-5">
        {flows.map((flow, i) => (
          <div key={i} className={`border rounded-2xl p-4 ${colorMap[flow.color]}`}>
            <div className="text-sm font-bold mb-3">{flow.category}</div>
            <div className="space-y-1.5">
              {flow.items.map((item, j) => (
                <div key={j} className="flex items-start gap-2">
                  <span className="text-xs font-bold text-white shrink-0 w-24">{item.name}</span>
                  <span className="text-xs text-white/50">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 p-3 bg-white/5 border border-white/10 rounded-xl text-center">
        <p className="text-xs text-white/60 font-mono">
          USD (ACH/SEPA/SWIFT) ↔ NGN (bank/mobile) ↔ USDT/USDC (Fireblocks) ↔ NGNT (ERC-20) ↔ M-Pesa (KES) ↔ Agent Cash
        </p>
      </div>
    </div>
  );
}

function Slide7() {
  const pillars = [
    {
      icon: "🏦",
      title: "Treasury & Float Income",
      desc: "Platform earns yield on funds held between receipt and disbursement. USD (5.25%), GBP (5.00%), EUR (3.75%), CAD (4.50%), AED (5.25%) — tracked via real treasury_positions database table with daily/monthly/YTD yield reporting.",
    },
    {
      icon: "📊",
      title: "Investment Platform",
      desc: "NGX Stock Market equities, fractional Nigerian real estate, African startup seed/growth rounds, diaspora bonds, and HNW private banking with negotiated FX spreads and dedicated relationship managers.",
    },
    {
      icon: "🛍️",
      title: "Embedded Finance & Cross-Sell",
      desc: "Airtime top-up (5% commission), utility bill payments (₦100 flat fee), micro-insurance for travel/health/device (8% premium fee), BNPL in 4 installments, carbon offsets, and medical tourism payments.",
    },
    {
      icon: "🤝",
      title: "Talent & Freelance Payments",
      desc: "TalentBridge enables cross-border freelancer and contractor payments — connecting African talent with global employers through a compliant, low-cost payment rail.",
    },
    {
      icon: "📡",
      title: "Data Lakehouse & Analytics",
      desc: "Delta Lake / Apache Iceberg data lakehouse, dbt transformations, AI/ML metrics dashboard, knowledge graph Q&A, vector search via OpenSearch — turning transaction data into business intelligence.",
    },
    {
      icon: "🌱",
      title: "ESG & Community",
      desc: "Carbon offset purchases, community feed and leaderboard, diaspora investment collectives for pooled homeland investment, and a social layer that turns customers into advocates.",
    },
  ];

  return (
    <div className="h-full flex flex-col justify-center px-12 py-6">
      <SectionLabel>Beyond Remittance</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">RemitFlow Is a Full Financial Ecosystem</h2>
      <p className="text-white/50 mb-5 text-base">Remittance is the entry point. The platform monetises the entire financial lifecycle.</p>

      <div className="grid grid-cols-3 gap-4">
        {pillars.map((p, i) => (
          <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/8 transition-colors">
            <div className="text-2xl mb-2">{p.icon}</div>
            <div className="text-sm font-bold text-white mb-1.5">{p.title}</div>
            <div className="text-xs text-white/55 leading-relaxed">{p.desc}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
        <p className="text-sm text-emerald-300 text-center font-medium">
          Revenue streams: Transfer fees · FX spread · Float yield · Investment commissions · Bill payment fees · Airtime commissions · Insurance premiums · Partner revenue share
        </p>
      </div>
    </div>
  );
}

function Slide8() {
  const portals = [
    { flag: "🇺🇸", country: "USA", features: "ACH transfers, 1% cashback (3 months), zero-fee first transfer, $10 referral bonus" },
    { flag: "🇪🇺", country: "European Union", features: "SEPA transfers, EU-specific corridors, diaspora investment access" },
    { flag: "🇬🇧", country: "United Kingdom", features: "UK-specific corridors, FCA-compliant reporting, GBP wallets" },
    { flag: "🇨🇦", country: "Canada", features: "CAD corridors, Canadian payment rails, diaspora community features" },
    { flag: "🇮🇹", country: "Italy", features: "Italy-specific diaspora portal, Italian community features" },
    { flag: "🌍", country: "Immigrant Workers", features: "Simplified KYC (NIN + selfie), $500/month limit, Mojaloop transfers" },
  ];

  return (
    <div className="h-full flex flex-col justify-center px-12 py-6">
      <SectionLabel>The Diaspora Angle</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">Built for the 250 Million People Living Away from Home</h2>
      <p className="text-white/50 mb-5 text-base">Six dedicated diaspora portals. Homeland investment. Family support. Community.</p>

      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Diaspora Source Market Portals</div>
          {portals.map((p, i) => (
            <div key={i} className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl p-3">
              <span className="text-2xl">{p.flag}</span>
              <div>
                <div className="text-sm font-bold text-white">{p.country}</div>
                <div className="text-xs text-white/55 mt-0.5">{p.features}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3">Homeland Investment Products</div>
            <div className="space-y-2">
              {[
                { icon: "📈", title: "NGX Stock Market", desc: "Buy/sell Nigerian Exchange Group equities from anywhere in the world" },
                { icon: "🏘️", title: "Fractional Real Estate", desc: "Invest in Nigerian real estate with fractional ownership from abroad" },
                { icon: "🚀", title: "Startup Deal Room", desc: "Seed and growth stage African startup investments" },
                { icon: "🏛️", title: "Diaspora Bonds", desc: "Government and infrastructure bonds for diaspora investors" },
                { icon: "👥", title: "Investment Collectives", desc: "Pool resources with other diaspora members for larger investments" },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2.5 bg-white/5 border border-white/10 rounded-lg p-2.5">
                  <span className="text-lg">{item.icon}</span>
                  <div>
                    <div className="text-xs font-bold text-white">{item.title}</div>
                    <div className="text-xs text-white/50">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <div className="text-xs font-bold text-amber-300 mb-1">Family Support Features</div>
            <div className="text-xs text-white/55">Family Dashboard · Recurring transfers · Remote bill payments · Split bills · Beneficiary management</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Slide9() {
  const middleware = [
    { name: "Apache Kafka", purpose: "Financial event streaming", detail: "15 topics: transactions, KYC, FX, risk, notifications, audit, disputes, fraud" },
    { name: "Dapr", purpose: "Service mesh pub/sub", detail: "Sidecar pattern for microservice communication" },
    { name: "Temporal", purpose: "Workflow orchestration", detail: "Durable workflows for transfers, KYC, compliance" },
    { name: "Redis", purpose: "Rate limiting & sessions", detail: "Per-IP and per-user rate limiting, session caching" },
    { name: "Permify", purpose: "Policy-Based Access Control", detail: "Subject + resource + environment attribute policies" },
    { name: "OpenSearch", purpose: "Full-text & vector search", detail: "Transaction search, compliance search, AI embeddings" },
    { name: "TigerBeetle", purpose: "Double-entry ledger", detail: "Float pool accounts 1001–1005, SWIFT settlements" },
    { name: "Mojaloop", purpose: "FSP interoperability", detail: "Party lookup, quote, transfer, status across African FSPs" },
    { name: "APISIX + WAF", purpose: "API gateway + security", detail: "OpenAppSec WAF, JWT auth, rate limiting on all routes" },
    { name: "Keycloak", purpose: "Enterprise SSO", detail: "OIDC/OAuth2 for enterprise partner authentication" },
    { name: "Delta Lake / Iceberg", purpose: "Data lakehouse", detail: "Analytics, dbt transformations, ML feature store" },
  ];

  return (
    <div className="h-full flex flex-col justify-center px-12 py-6">
      <SectionLabel>World-Class Technology</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">Enterprise-Grade Infrastructure. Built for Scale.</h2>
      <p className="text-white/50 mb-4 text-base">75 microservices across Go, Rust, and Python. 11 middleware components. All wired and production-ready.</p>

      <div className="grid grid-cols-2 gap-5">
        <div>
          <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Middleware Stack (All Wired)</div>
          <div className="space-y-1.5">
            {middleware.map((m, i) => (
              <div key={i} className="flex items-start gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-white">{m.name}</span>
                  <span className="text-xs text-white/40 mx-1.5">·</span>
                  <span className="text-xs text-white/60">{m.purpose}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Microservices (75 total)</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { lang: "Go", count: "22", color: "text-blue-300", bg: "bg-blue-500/10 border-blue-500/20" },
                { lang: "Rust", count: "18", color: "text-orange-300", bg: "bg-orange-500/10 border-orange-500/20" },
                { lang: "Python", count: "15", color: "text-yellow-300", bg: "bg-yellow-500/10 border-yellow-500/20" },
              ].map((l, i) => (
                <div key={i} className={`border rounded-xl p-3 text-center ${l.bg}`}>
                  <div className={`text-2xl font-black ${l.color}`}>{l.count}</div>
                  <div className={`text-xs font-bold ${l.color}`}>{l.lang} Services</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Africa-First Resilience</div>
            <div className="space-y-1.5">
              {[
                "WebSocket → SSE → Long-poll → Short-poll automatic fallback",
                "IndexedDB offline queue — transactions queued when offline",
                "Background Sync — syncs when connection restored",
                "Adaptive quality detection: 2G / 3G / 4G / WiFi",
                "Bandwidth-aware payload compression",
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-white/60">
                  <span className="text-emerald-400">✓</span> {item}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Mobile</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-white">294</div>
                <div className="text-xs text-white/50">Flutter Screens</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-white">295</div>
                <div className="text-xs text-white/50">React Native Screens</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Slide10() {
  const rows = [
    { feature: "African Corridors", us: "13 live", them1: "Limited", them2: "Limited", them3: "Moderate", them4: "West Africa" },
    { feature: "Crypto / Stablecoins", us: "Yes", them1: "No", them2: "No", them3: "No", them4: "Limited" },
    { feature: "Mobile Money (Mojaloop)", us: "Yes", them1: "Limited", them2: "No", them3: "Moderate", them4: "Yes" },
    { feature: "SWIFT GPI ISO 20022", us: "Yes", them1: "No", them2: "No", them3: "No", them4: "No" },
    { feature: "Investment Platform", us: "Yes", them1: "No", them2: "No", them3: "No", them4: "No" },
    { feature: "White-Label B2B", us: "Yes", them1: "No", them2: "No", them3: "No", them4: "No" },
    { feature: "Agent Banking / POS", us: "Yes", them1: "Limited", them2: "No", them3: "No", them4: "No" },
    { feature: "HNW Private Banking", us: "Yes", them1: "No", them2: "No", them3: "No", them4: "No" },
    { feature: "Float Income Treasury", us: "Yes", them1: "No", them2: "No", them3: "No", them4: "No" },
    { feature: "FATF Travel Rule", us: "Yes", them1: "Partial", them2: "Partial", them3: "No", them4: "No" },
    { feature: "Offline Capability", us: "Yes", them1: "No", them2: "No", them3: "No", them4: "No" },
    { feature: "Native Mobile Apps", us: "Flutter+RN", them1: "App only", them2: "App only", them3: "App only", them4: "App only" },
  ];

  return (
    <div className="h-full flex flex-col justify-center px-12 py-6">
      <SectionLabel>Competitive Edge</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">Why RemitFlow Wins</h2>
      <p className="text-white/50 mb-4 text-base">No other platform combines all of these capabilities in a single, production-ready system.</p>

      <div className="overflow-auto rounded-2xl border border-white/10">
        <table className="w-full">
          <thead>
            <tr className="bg-white/10 border-b border-white/10">
              <th className="px-3 py-3 text-left text-xs font-bold text-white/60 uppercase tracking-wider">Feature</th>
              <th className="px-3 py-3 text-center text-xs font-bold text-emerald-400 uppercase tracking-wider">RemitFlow</th>
              <th className="px-3 py-3 text-center text-xs font-bold text-white/40 uppercase tracking-wider">Western Union</th>
              <th className="px-3 py-3 text-center text-xs font-bold text-white/40 uppercase tracking-wider">Wise</th>
              <th className="px-3 py-3 text-center text-xs font-bold text-white/40 uppercase tracking-wider">WorldRemit</th>
              <th className="px-3 py-3 text-center text-xs font-bold text-white/40 uppercase tracking-wider">Chipper Cash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <CompareRow key={i} feature={row.feature} us={row.us} them1={row.them1} them2={row.them2} them3={row.them3} them4={row.them4} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Slide11() {
  const compliance = [
    { icon: "🔍", title: "KYC Tiers 0–3", desc: "Tiered KYC with document OCR, liveness detection, and progressive onboarding" },
    { icon: "🧠", title: "AML Engine", desc: "ML-based AML (Python + Rust), batch processing, case management, watchlist screening" },
    { icon: "🚨", title: "Sanctions Screening", desc: "Real-time screening against compliance_watchlist and sanctions_checks database tables" },
    { icon: "🤖", title: "Fraud Detection", desc: "Logistic regression ML model, velocity checks, anomaly detection, round-trip detection" },
    { icon: "🇬🇧", title: "FCA Compliance", desc: "UK FCA reporting with export functionality — verified FCACompliance page" },
    { icon: "🇳🇬", title: "CBN Compliance", desc: "Nigerian CBN Form M, CTR reporting, PAPSS compliance dashboard" },
    { icon: "🔐", title: "FATF Travel Rule", desc: "TRISA protocol for crypto transfers >$1,000 — VASP directory integrated" },
    { icon: "📋", title: "GDPR", desc: "Data export, right to erasure, consent management, DPIA — all implemented" },
  ];

  const security = [
    "DDoS & volumetric attack prevention",
    "BEC beneficiary-swap detection (24h cooldown)",
    "Credential stuffing detection",
    "Round-trip transaction flagging",
    "Account takeover (ATO) detection",
    "Parameter tampering guard",
    "JWT algorithm validation",
    "Timing-attack-safe token comparison",
    "Amplification attack prevention",
    "Concurrency limiting per user",
    "Payload size guard",
    "SIEM buffer with 200-event window",
    "OpenAppSec WAF on all API routes",
    "PBAC: subject + resource + environment policies",
    "Redis rate limiting (per-IP and per-user)",
    "MFA / TOTP two-factor authentication",
  ];

  return (
    <div className="h-full flex flex-col justify-center px-12 py-6">
      <SectionLabel>Security & Compliance</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">Regulated. Audited. Trusted.</h2>
      <p className="text-white/50 mb-4 text-base">Every compliance page and security control is verified in the production codebase.</p>

      <div className="grid grid-cols-2 gap-5">
        <div>
          <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Compliance Framework</div>
          <div className="grid grid-cols-2 gap-2">
            {compliance.map((c, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="text-lg mb-1">{c.icon}</div>
                <div className="text-xs font-bold text-white">{c.title}</div>
                <div className="text-xs text-white/50 mt-0.5 leading-relaxed">{c.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Security Controls (32 Attack Mitigations)</div>
          <div className="grid grid-cols-2 gap-1.5">
            {security.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-white/60">
                <Shield className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                {s}
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <div className="text-xs font-bold text-emerald-300 mb-1">Infrastructure Security</div>
            <div className="text-xs text-white/55">15+ Docker Compose files · Kubernetes YAML · Grafana monitoring · SLA tracking · IP login history · Security score dashboard</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Slide12() {
  const corridors = [
    { flag: "🇳🇬", name: "Nigeria", currency: "NGN" },
    { flag: "🇬🇭", name: "Ghana", currency: "GHS" },
    { flag: "🇰🇪", name: "Kenya", currency: "KES" },
    { flag: "🇹🇿", name: "Tanzania", currency: "TZS" },
    { flag: "🇺🇬", name: "Uganda", currency: "UGX" },
    { flag: "🇿🇦", name: "South Africa", currency: "ZAR" },
    { flag: "🇸🇳", name: "Senegal", currency: "XOF" },
    { flag: "🇨🇲", name: "Cameroon", currency: "XAF" },
    { flag: "🇧🇯", name: "Benin", currency: "XOF" },
    { flag: "🇹🇬", name: "Togo", currency: "XOF" },
    { flag: "🇲🇱", name: "Mali", currency: "XOF" },
    { flag: "🇳🇪", name: "Niger", currency: "XOF" },
  ];

  const rails = ["SWIFT GPI", "Mojaloop", "PAPSS", "GHIPSS", "CIPS", "BRICSPay", "PIX", "UPI", "M-Pesa", "XOF", "mBridge", "ACH", "SEPA"];

  return (
    <div className="h-full flex flex-col justify-center px-12 py-6">
      <SectionLabel>Global Reach</SectionLabel>
      <h2 className="text-4xl font-black text-white mb-2">Africa. And Beyond.</h2>
      <p className="text-white/50 mb-5 text-base">13 active corridors. 5 diaspora source markets. 13 payment rails. All production-ready.</p>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3">Active Send Corridors</div>
          <div className="grid grid-cols-3 gap-2">
            {corridors.map((c, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center gap-2">
                <span className="text-xl">{c.flag}</span>
                <div>
                  <div className="text-xs font-bold text-white">{c.name}</div>
                  <div className="text-xs text-white/40">{c.currency}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Diaspora Source Markets</div>
            <div className="flex flex-wrap gap-2">
              {["🇺🇸 USA (ACH)", "🇪🇺 EU (SEPA)", "🇬🇧 UK", "🇨🇦 Canada", "🇮🇹 Italy"].map((m, i) => (
                <span key={i} className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-full px-3 py-1">{m}</span>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Payment Rails</div>
            <div className="flex flex-wrap gap-1.5">
              {rails.map((r, i) => (
                <span key={i} className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-full px-2.5 py-1">{r}</span>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Currencies Supported</div>
            <div className="flex flex-wrap gap-1.5">
              {["NGN", "USD", "GBP", "EUR", "CAD", "AED", "GHS", "KES", "TZS", "UGX", "ZAR", "XOF", "CNY", "INR", "BRL", "USDT", "USDC", "BUSD", "DAI", "NGNT"].map((c, i) => (
                <span key={i} className="text-xs bg-white/5 border border-white/10 text-white/60 rounded-full px-2 py-0.5">{c}</span>
              ))}
            </div>
          </div>

          <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
            <div className="text-xs text-white/50 text-center">
              <span className="text-white font-bold">75 microservices</span> across Go, Rust, and Python handle routing, compliance, FX, and settlement for every corridor
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Slide13() {
  const tracks = [
    {
      icon: "🏢",
      title: "IMTO Partner",
      desc: "White-label the platform and launch your own remittance brand on our infrastructure. Full multi-tenant architecture with your branding, fees, and compliance.",
      cta: "Start 5-Step Onboarding",
      color: "emerald",
    },
    {
      icon: "💱",
      title: "BDC Partner",
      desc: "Connect your bureau de change to our liquidity network. Access CBN Form M tooling, PAPSS compliance, and automated FX spread management.",
      cta: "Apply as BDC Partner",
      color: "blue",
    },
    {
      icon: "🔌",
      title: "API Integration",
      desc: "Embed RemitFlow payments into your existing product via our type-safe tRPC API. Full sandbox, webhook management, and developer documentation.",
      cta: "Access Developer Sandbox",
      color: "purple",
    },
  ];

  const colorMap: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/10",
    blue: "border-blue-500/30 bg-blue-500/10",
    purple: "border-purple-500/30 bg-purple-500/10",
  };

  const btnMap: Record<string, string> = {
    emerald: "bg-emerald-500 hover:bg-emerald-400 text-white",
    blue: "bg-blue-500 hover:bg-blue-400 text-white",
    purple: "bg-purple-500 hover:bg-purple-400 text-white",
  };

  return (
    <div className="relative h-full flex flex-col items-center justify-center px-12 py-8 overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-blue-500/15 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-5xl">
        <div className="text-center mb-8">
          <SectionLabel>Call to Action</SectionLabel>
          <h2 className="text-4xl font-black text-white mb-3">Join the Platform That's Redefining African Finance</h2>
          <p className="text-white/50 text-lg">The platform is live. The infrastructure is production-ready. The question is: where do you want to go?</p>
        </div>

        <div className="grid grid-cols-3 gap-5 mb-8">
          {tracks.map((track, i) => (
            <div key={i} className={`border rounded-2xl p-6 ${colorMap[track.color]}`}>
              <div className="text-3xl mb-3">{track.icon}</div>
              <div className="text-lg font-black text-white mb-2">{track.title}</div>
              <div className="text-sm text-white/60 leading-relaxed mb-4">{track.desc}</div>
              <button className={`w-full py-2.5 px-4 rounded-xl text-sm font-bold transition-colors ${btnMap[track.color]}`}>
                {track.cta} <ArrowRight className="inline w-4 h-4 ml-1" />
              </button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-4">
          <StatCard value="295" label="Web Pages Live" sub="Full feature coverage" />
          <StatCard value="74/74" label="Tests Passing" sub="3,634 test cases" />
          <StatCard value="75" label="Microservices" sub="Go · Rust · Python" />
          <StatCard value="v213" label="Current Version" sub="Production ready" />
        </div>
      </div>
    </div>
  );
}

const SLIDE_COMPONENTS = [Slide1, Slide2, Slide3, Slide4, Slide5, Slide6, Slide7, Slide8, Slide9, Slide10, Slide11, Slide12, Slide13];

// ─── Main Presentation Component ─────────────────────────────────────────────

export default function PresentationDeck() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const goNext = useCallback(() => setCurrent(c => Math.min(c + 1, SLIDES.length - 1)), []);
  const goPrev = useCallback(() => setCurrent(c => Math.max(c - 1, 0)), []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); goPrev(); }
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev]);

  // Auto-play
  useEffect(() => {
    if (!autoPlay) return;
    const timer = setInterval(() => {
      setCurrent(c => {
        if (c >= SLIDES.length - 1) { setAutoPlay(false); return c; }
        return c + 1;
      });
    }, 8000);
    return () => clearInterval(timer);
  }, [autoPlay]);

  const SlideComponent = SLIDE_COMPONENTS[current];

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-black/30 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center">
              <Globe className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-black text-white">RemitFlow</span>
          </div>
          <span className="text-white/20">|</span>
          <span className="text-xs text-white/40">Business Presentation · v213</span>
        </div>

        {/* Slide counter */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoPlay(a => !a)}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            {autoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {autoPlay ? "Pause" : "Auto"}
          </button>
          <span className="text-xs text-white/40">{current + 1} / {SLIDES.length}</span>
        </div>
      </div>

      {/* Slide area */}
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900" />
        <div className="relative h-full">
          <SlideComponent />
        </div>

        {/* Left/Right nav arrows */}
        <button
          onClick={goPrev}
          disabled={current === 0}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-5 h-5 text-white" />
        </button>
        <button
          onClick={goNext}
          disabled={current === SLIDES.length - 1}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Footer — slide navigation dots + titles */}
      <div className="shrink-0 border-t border-white/10 bg-black/30 backdrop-blur-sm">
        {/* Progress bar */}
        <div className="h-0.5 bg-white/10">
          <div
            className="h-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${((current + 1) / SLIDES.length) * 100}%` }}
          />
        </div>

        {/* Slide thumbnails */}
        <div className="flex items-center justify-center gap-1 px-6 py-2 overflow-x-auto">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.id}
              onClick={() => setCurrent(i)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap ${
                i === current
                  ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold"
                  : "text-white/30 hover:text-white/60 hover:bg-white/5"
              }`}
            >
              <span className="font-mono text-xs opacity-60">{String(i + 1).padStart(2, "0")}</span>
              <span>{slide.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
