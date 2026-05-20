import { useState } from "react";
import { CommunityActivityFeed } from "@/components/CommunityActivityFeed";
import { TrendingFundsWidget } from "@/components/TrendingFundsWidget";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ShoppingBag, Briefcase, Heart, TrendingUp, Users, Gift,
  ArrowRight, Globe, Shield, Zap, Star, ChevronRight,
  Building2, Leaf, BookOpen, Smartphone, Wifi, Bell
} from "lucide-react";
import { useTranslation } from 'react-i18next';

const ECOSYSTEM_FEATURES = [
  {
    id: "marketplace",
    path: "/marketplace",
    icon: ShoppingBag,
    label: "AfriMarket",
    tagline: "Pan-African P2P Marketplace",
    description: "Buy and sell goods, services, and crafts across 54 African countries and the diaspora. Escrow-protected transactions.",
    color: "from-amber-500/20 to-orange-500/10",
    border: "border-amber-500/30",
    iconBg: "bg-amber-500/20",
    iconColor: "text-amber-400",
    badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    badge: "P2P Marketplace",
    stats: [
      { label: "Active Listings", value: "30+" },
      { label: "Countries", value: "54" },
      { label: "Escrow Protected", value: "100%" },
    ],
    highlights: ["KYC-verified sellers", "Escrow payment protection", "Dispute resolution", "Seller ratings"],
  },
  {
    id: "talent",
    path: "/talent",
    icon: Briefcase,
    label: "TalentBridge",
    tagline: "Diaspora Talent Network",
    description: "Connect diaspora professionals with African institutions. Post opportunities, build your profile, get booked.",
    color: "from-blue-500/20 to-cyan-500/10",
    border: "border-blue-500/30",
    iconBg: "bg-blue-500/20",
    iconColor: "text-blue-400",
    badgeColor: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    badge: "Professional Network",
    stats: [
      { label: "Expert Profiles", value: "15+" },
      { label: "Open Roles", value: "12" },
      { label: "Sectors", value: "12" },
    ],
    highlights: ["Fintech & Banking experts", "Healthcare professionals", "Engineering talent", "Hourly rate booking"],
  },
  {
    id: "community",
    path: "/community",
    icon: Heart,
    label: "Community Funds",
    tagline: "Collective Impact Finance",
    description: "Pool resources with the diaspora to fund education, healthcare, and infrastructure projects back home.",
    color: "from-rose-500/20 to-pink-500/10",
    border: "border-rose-500/30",
    iconBg: "bg-rose-500/20",
    iconColor: "text-rose-400",
    badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    badge: "Impact Finance",
    stats: [
      { label: "Active Funds", value: "9" },
      { label: "Proposals", value: "18" },
      { label: "Countries", value: "10" },
    ],
    highlights: ["Democratic voting", "Transparent disbursement", "8 impact themes", "Real-time progress"],
  },
  {
    id: "invest",
    path: "/invest",
    icon: TrendingUp,
    label: "DiasporaVest",
    tagline: "Invest in Africa's Future",
    description: "Go beyond remittances. Pool capital with fellow diaspora members to access curated investment opportunities.",
    color: "from-emerald-500/20 to-teal-500/10",
    border: "border-emerald-500/30",
    iconBg: "bg-emerald-500/20",
    iconColor: "text-emerald-400",
    badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    badge: "Investment Club",
    stats: [
      { label: "Opportunities", value: "8+" },
      { label: "Collectives", value: "6" },
      { label: "Sectors", value: "5" },
    ],
    highlights: ["Seed & growth rounds", "Diaspora bonds", "Collective investing", "Portfolio tracking"],
  },
  {
    id: "family",
    path: "/family",
    icon: Users,
    label: "Family Dashboard",
    tagline: "Smart Family Finance",
    description: "Manage your entire family's remittance needs in one place. Set budgets, track spending, and send to multiple members.",
    color: "from-violet-500/20 to-purple-500/10",
    border: "border-violet-500/30",
    iconBg: "bg-violet-500/20",
    iconColor: "text-violet-400",
    badgeColor: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    badge: "Family Finance",
    stats: [
      { label: "Members", value: "6+" },
      { label: "Currencies", value: "10" },
      { label: "Relationships", value: "9" },
    ],
    highlights: ["Monthly budget limits", "Spending alerts", "Multi-currency", "Transfer history per member"],
  },
  {
    id: "referral",
    path: "/referral",
    icon: Gift,
    label: "Referral Program",
    tagline: "Earn While You Share",
    description: "Invite friends to RemitFlow and earn rewards. Climb from Bronze to Platinum tier for bigger bonuses.",
    color: "from-yellow-500/20 to-amber-500/10",
    border: "border-yellow-500/30",
    iconBg: "bg-yellow-500/20",
    iconColor: "text-yellow-400",
    badgeColor: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    badge: "Rewards",
    stats: [
      { label: "Tiers", value: "4" },
      { label: "Max Reward", value: "₦1,500" },
      { label: "Fee Discount", value: "15%" },
    ],
    highlights: ["Bronze to Platinum tiers", "₦500–₦1,500 per referral", "Fee discounts", "Global leaderboard"],
  },
];

const PWA_FEATURES = [
  { icon: Wifi, label: "Offline Ready", desc: "Browse marketplace & community funds without internet", color: "text-green-400" },
  { icon: Bell, label: "Push Alerts", desc: "Get notified when orders ship, proposals pass votes, or FX rates hit targets", color: "text-yellow-400" },
  { icon: Smartphone, label: "Install as App", desc: "Add to home screen for a native app experience on any device", color: "text-blue-400" },
  { icon: Zap, label: "Instant Loading", desc: "Cached community data loads instantly, even on slow connections", color: "text-purple-400" },
];

export default function CommunityHub() {
  const { t } = useTranslation();
  const [hoveredFeature, setHoveredFeature] = useState<string | null>(null);

  // Fetch live stats
  const { data: communityFunds } = trpc.community.listFunds.useQuery();
  const { data: marketListings } = trpc.marketplace.listListings.useQuery({ page: 1, pageSize: 1 });
  const { data: talentExperts } = trpc.talent.listExperts.useQuery();
  const { data: collectives } = trpc.diaspora.listCollectives.useQuery();

  const totalFundsRaised = (communityFunds as any[] ?? []).reduce((s: number, f: any) => s + Number(f.totalRaised ?? 0), 0);
  const totalContributors = (communityFunds as any[] ?? []).reduce((s: number, f: any) => s + Number(f.contributorCount ?? 0), 0);
  const totalListings = marketListings?.total ?? 0;
  const totalExperts = talentExperts?.length ?? 0;
  const totalCollectives = collectives?.length ?? 0;

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
        {/* Hero */}
        <div className="relative overflow-hidden px-6 pt-10 pb-8">
          {/* Background decoration */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full bg-indigo-500/5 blur-3xl" />
            <div className="absolute -bottom-20 -left-20 w-96 h-96 rounded-full bg-purple-500/5 blur-3xl" />
          </div>
          <div className="relative max-w-5xl mx-auto">
            <div className="flex items-center gap-2 mb-4">
              <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs px-3 py-1">
                <Globe className="w-3 h-3 mr-1.5" /> Community & Ecosystem
              </Badge>
              <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs px-3 py-1">
                <Smartphone className="w-3 h-3 mr-1.5" /> PWA Ready
              </Badge>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
              The Diaspora's<br />
              <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                Digital Home
              </span>
            </h1>
            <p className="text-slate-400 text-lg max-w-2xl mb-8 leading-relaxed">
              Six interconnected platforms built for the African diaspora — from marketplace to investment clubs, 
              talent networks to community funds. All in one installable app.
            </p>

            {/* Live Platform Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              {[
                { label: "Market Listings", value: totalListings || "30+", icon: ShoppingBag, color: "text-amber-400" },
                { label: "Diaspora Experts", value: totalExperts || "15+", icon: Briefcase, color: "text-blue-400" },
                { label: "Funds Raised", value: `$${(totalFundsRaised / 1000).toFixed(0)}K+`, icon: Heart, color: "text-rose-400" },
                { label: "Contributors", value: totalContributors || "50+", icon: Users, color: "text-violet-400" },
                { label: "Collectives", value: totalCollectives || "6", icon: TrendingUp, color: "text-emerald-400" },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 text-center">
                  <Icon className={`w-5 h-5 mx-auto mb-2 ${color}`} />
                  <div className="text-xl font-bold text-white">{value}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="px-6 pb-8 max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Ecosystem Platforms</h2>
            <span className="text-sm text-slate-400">6 platforms, 1 app</span>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {ECOSYSTEM_FEATURES.map((feature) => {
              const Icon = feature.icon;
              const isHovered = hoveredFeature === feature.id;
              return (
                <Link key={feature.id} href={feature.path}>
                  <div
                    className={`relative group rounded-2xl border bg-gradient-to-br ${feature.color} ${feature.border} p-5 cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-black/20`}
                    onMouseEnter={() => setHoveredFeature(feature.id)}
                    onMouseLeave={() => setHoveredFeature(null)}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className={`p-2.5 rounded-xl ${feature.iconBg} border ${feature.border}`}>
                        <Icon className={`w-5 h-5 ${feature.iconColor}`} />
                      </div>
                      <Badge className={`text-xs ${feature.badgeColor}`}>{feature.badge}</Badge>
                    </div>

                    {/* Title & Description */}
                    <h3 className="text-lg font-bold text-white mb-1">{feature.label}</h3>
                    <p className="text-xs text-slate-400 mb-1 font-medium">{feature.tagline}</p>
                    <p className="text-sm text-slate-300 leading-relaxed mb-4">{feature.description}</p>

                    {/* Stats Row */}
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {feature.stats.map(({ label, value }) => (
                        <div key={label} className="bg-black/20 rounded-lg p-2 text-center">
                          <div className={`text-sm font-bold ${feature.iconColor}`}>{value}</div>
                          <div className="text-xs text-slate-500 mt-0.5 leading-tight">{label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Highlights */}
                    <div className="space-y-1.5 mb-4">
                      {feature.highlights.map((h) => (
                        <div key={h} className="flex items-center gap-2 text-xs text-slate-300">
                          <div className={`w-1.5 h-1.5 rounded-full ${feature.iconColor} bg-current shrink-0`} />
                          {h}
                        </div>
                      ))}
                    </div>

                    {/* CTA */}
                    <div className={`flex items-center gap-1 text-sm font-semibold ${feature.iconColor} group-hover:gap-2 transition-all`}>
                      Open {feature.label} <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* PWA Features Section */}
        <div className="px-6 pb-10 max-w-5xl mx-auto">
          <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 to-purple-500/5 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30">
                <Smartphone className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Progressive Web App</h2>
                <p className="text-sm text-slate-400">Install RemitFlow for the full native experience</p>
              </div>
              <div className="ml-auto">
                <Badge className="bg-green-500/20 text-green-300 border-green-500/30">Installable</Badge>
              </div>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              {PWA_FEATURES.map(({ icon: Icon, label, desc, color }) => (
                <div key={label} className="bg-black/20 rounded-xl p-4 border border-white/5">
                  <Icon className={`w-5 h-5 mb-3 ${color}`} />
                  <div className="text-sm font-semibold text-white mb-1">{label}</div>
                  <div className="text-xs text-slate-400 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-400 bg-black/20 rounded-lg px-3 py-2">
                <Shield className="w-3.5 h-3.5 text-green-400" /> Service Worker v15 active
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 bg-black/20 rounded-lg px-3 py-2">
                <Zap className="w-3.5 h-3.5 text-yellow-400" /> Community data cached (5 min TTL)
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 bg-black/20 rounded-lg px-3 py-2">
                <Star className="w-3.5 h-3.5 text-purple-400" /> 7 PWA shortcuts configured
              </div>
            </div>
          </div>
        </div>

        {/* Trending Funds Widget */}
        <div className="px-6 pb-8 max-w-5xl mx-auto">
          <TrendingFundsWidget dark />
        </div>
        {/* Live Activity Feed + Platform Highlights */}
        <div className="px-6 pb-8 max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Activity Feed */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
              <CommunityActivityFeed showHeader compact />
            </div>
            {/* Platform highlights */}
            <div className="space-y-4">
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-white mb-3">Platform Highlights</h3>
                <div className="space-y-3">
                  {[
                    { label: "Avg. transfer time", value: "2.3 min", color: "text-green-400" },
                    { label: "Marketplace GMV (30d)", value: "$142K", color: "text-orange-400" },
                    { label: "Community funds raised", value: "$89K", color: "text-pink-400" },
                    { label: "Talent sessions booked", value: "1,240", color: "text-blue-400" },
                    { label: "Active diaspora collectives", value: "34", color: "text-purple-400" },
                    { label: "Referral rewards paid", value: "$12K", color: "text-yellow-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{label}</span>
                      <span className={`text-sm font-bold ${color}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-gradient-to-br from-indigo-600/20 to-purple-600/10 border border-indigo-500/20 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-white mb-1">Install as App</h3>
                <p className="text-xs text-slate-400 mb-3">Get instant access to all 6 community platforms from your home screen.</p>
                <div className="flex gap-2">
                  <span className="text-xs bg-indigo-500/20 text-indigo-300 rounded-lg px-2 py-1">iOS</span>
                  <span className="text-xs bg-indigo-500/20 text-indigo-300 rounded-lg px-2 py-1">Android</span>
                  <span className="text-xs bg-indigo-500/20 text-indigo-300 rounded-lg px-2 py-1">Desktop</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Quick Action Grid */}
        <div className="px-6 pb-10 max-w-5xl mx-auto">
          <h2 className="text-xl font-bold text-white mb-6">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Browse Market", path: "/marketplace", icon: ShoppingBag, color: "bg-amber-500/20 text-amber-400" },
              { label: "Find Talent", path: "/talent", icon: Briefcase, color: "bg-blue-500/20 text-blue-400" },
              { label: "Fund Project", path: "/community", icon: Heart, color: "bg-rose-500/20 text-rose-400" },
              { label: "Invest Now", path: "/invest", icon: TrendingUp, color: "bg-emerald-500/20 text-emerald-400" },
              { label: "Family Send", path: "/family", icon: Users, color: "bg-violet-500/20 text-violet-400" },
              { label: "Earn Rewards", path: "/referral", icon: Gift, color: "bg-yellow-500/20 text-yellow-400" },
            ].map(({ label, path, icon: Icon, color }) => (
              <Link key={label} href={path}>
                <div className={`flex flex-col items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-800/50 p-4 cursor-pointer hover:bg-slate-700/50 transition-colors text-center`}>
                  <div className={`p-2.5 rounded-xl ${color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-medium text-slate-300">{label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Footer CTA */}
        <div className="px-6 pb-10 max-w-5xl mx-auto">
          <div className="rounded-2xl bg-gradient-to-r from-indigo-600/30 via-purple-600/20 to-pink-600/10 border border-indigo-500/20 p-8 text-center">
            <Globe className="w-10 h-10 text-indigo-400 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-white mb-2">One Platform. Infinite Connections.</h3>
            <p className="text-slate-400 text-sm max-w-lg mx-auto mb-6">
              RemitFlow is more than a money transfer app. It's the financial infrastructure for the African diaspora — 
              connecting communities, enabling investment, and building collective wealth.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/send-money">
                <Button className="bg-indigo-600 hover:bg-indigo-500 text-white">
                  Send Money <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <Link href="/marketplace">
                <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-800">
                  Explore AfriMarket
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
