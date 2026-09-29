/**
 * /invest — investment hub.
 *
 * Entry page for all investment surfaces. Status badges reflect verified
 * backend reality (audit/routers.json + the server routers on
 * bdc-integration), not marketing copy:
 *  - Bonds / Real Estate / Startups / Community / Escrow routers are mounted
 *    and functional (money moves through guarded wallet debits).
 *  - Stocks order capture is live (tier-2 KYC + TOTP + stale-price refusal
 *    enforced server-side) but broker settlement is NOT_IMPLEMENTED —
 *    ngxStocks.brokerWebhook always fails closed and executions are
 *    reconciled manually by operations. The badge says so.
 */
import React from "react";
import { Link } from "react-router-dom";
import { Badge, PageHeader } from "../bdc/ui";

type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

interface InvestSection {
  path: string;
  title: string;
  description: string;
  badge: string;
  tone: Tone;
  footnote?: string;
}

const SECTIONS: InvestSection[] = [
  {
    path: "/invest/bonds",
    title: "Diaspora Bonds",
    description:
      "Government and infrastructure bonds for the diaspora — subscribe from your USD wallet, track coupons, trade on the secondary market, or redeem early.",
    badge: "Live",
    tone: "ok",
  },
  {
    path: "/invest/stocks",
    title: "NGX Stocks",
    description:
      "Nigerian Exchange equities — browse listings, watchlist, and place orders from your NGN wallet.",
    badge: "Broker connectivity in progress",
    tone: "warn",
    footnote:
      "Orders are captured and funds held, but broker settlement is not yet automated — executions are reconciled manually by operations. Orders are never presented as executed trades.",
  },
  {
    path: "/invest/real-estate",
    title: "Real Estate",
    description:
      "Fractional ownership of vetted property listings — invest per share and track holdings.",
    badge: "Live — custody settled by operations",
    tone: "ok",
    footnote:
      "Investments debit your wallet immediately; asset custody is confirmed manually by operations.",
  },
  {
    path: "/invest/startups",
    title: "Startup Deals",
    description:
      "Curated African startup raises — commit capital and track your portfolio.",
    badge: "Live — custody settled by operations",
    tone: "ok",
    footnote:
      "Commitments debit your wallet immediately; custody/agreements are confirmed manually by operations.",
  },
  {
    path: "/invest/community",
    title: "Community Funds",
    description:
      "Community investment pools — browse funds, contribute, and vote on proposals.",
    badge: "Live",
    tone: "ok",
  },
  {
    path: "/invest/escrow",
    title: "Property Escrow",
    description:
      "Milestone-based property purchase escrow — deposits, installments, and evidence tracking.",
    badge: "Live — releases reviewed by operations",
    tone: "ok",
    footnote:
      "Milestone releases and dispute resolutions are reviewed and executed by operations, not self-serve.",
  },
];

const InvestHub: React.FC = () => (
  <div className="space-y-6">
    <PageHeader
      title="Invest"
      subtitle="Bonds, equities, property, startups and community pools — every surface below is wired to a live backend router; status badges reflect real backend capability."
    />

    <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-sm text-indigo-700">
      Investment actions are guarded: tier-2 KYC and an eligible plan are
      required by the backend, and money-moving steps ask for your 6-digit 2FA
      code when you have two-factor authentication enrolled. Rejections from
      those guards are shown to you verbatim — they are never hidden.
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {SECTIONS.map((s) => (
        <Link
          key={s.path}
          to={s.path}
          className="block bg-white rounded-2xl border border-slate-100 p-5 hover:border-indigo-200 hover:shadow-sm transition-all"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">{s.title}</h2>
            <Badge tone={s.tone}>{s.badge}</Badge>
          </div>
          <p className="text-sm text-slate-500 mt-2">{s.description}</p>
          {s.footnote && (
            <p className="text-xs text-slate-400 mt-3">{s.footnote}</p>
          )}
          <span className="inline-block mt-4 text-sm font-medium text-indigo-600">
            Open →
          </span>
        </Link>
      ))}
    </div>
  </div>
);

export default InvestHub;
