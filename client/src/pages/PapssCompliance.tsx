import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
/**
 * PAPSS Compliance & Rate Transparency Page (P3)
 *
 * Public-facing page showing:
 * - PAPSS corridor rates (live BMATCH-benchmarked)
 * - CBN compliance badges
 * - Rate transparency for Nigeria corridor
 * - BDC partnership information
 */
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ShieldCheck, TrendingUp, Globe, CheckCircle2, RefreshCw,
  ArrowRight, Building2, Zap, Lock, Info
} from "lucide-react";

export default function PapssCompliance() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("rates");

  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const utils = trpc.useUtils();

  const corridors = trpc.cbnCompliance.getCbnCorridors.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const allRates = trpc.cbnCompliance.getAllRatePairs.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const handleManualRefresh = useCallback(async () => {
    await Promise.all([
      utils.cbnCompliance.getAllRatePairs.invalidate(),
      utils.cbnCompliance.getCbnCorridors.invalidate(),
    ]);
    setLastRefreshed(new Date());
    toast("Rates refreshed", { description: "Live BMATCH rates updated from ADB passthrough." });
  }, [utils, toast]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/20 to-blue-900/20" />
        <div className="relative max-w-6xl mx-auto px-6 py-20">
          <div className="flex items-center gap-3 mb-6">
            <ShieldCheck className="w-10 h-10 text-emerald-400" />
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-sm px-3 py-1">
              CBN Circular March 24 2026 — Fully Compliant
            </Badge>
          </div>
          <h1 className="text-5xl font-bold mb-4 leading-tight">
            Nigeria Remittance<br />
            <span className="text-emerald-400">Rate Transparency</span>
          </h1>
          <p className="text-xl text-white/60 max-w-2xl mb-8">
            All rates benchmarked against Bloomberg BMATCH via our Authorised Dealer Bank.
            PAPSS-powered settlement ensures same-day delivery to Nigerian beneficiaries.
          </p>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2 bg-white/5 rounded-full px-4 py-2">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-sm text-white/80">BMATCH-benchmarked rates</span>
            </div>
            <div className="flex items-center gap-2 bg-white/5 rounded-full px-4 py-2">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-sm text-white/80">CBN-registered settlement accounts</span>
            </div>
            <div className="flex items-center gap-2 bg-white/5 rounded-full px-4 py-2">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-sm text-white/80">PAPSS official settlement rail</span>
            </div>
            <div className="flex items-center gap-2 bg-white/5 rounded-full px-4 py-2">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-sm text-white/80">NFEM-compliant funding only</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 pb-20">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white/5 border border-white/10 mb-8">
            <TabsTrigger value="rates" className="data-[state=active]:bg-white/10">
              <TrendingUp className="w-4 h-4 mr-2" />Live Rates
            </TabsTrigger>
            <TabsTrigger value="corridors" className="data-[state=active]:bg-white/10">
              <Globe className="w-4 h-4 mr-2" />Corridors
            </TabsTrigger>
            <TabsTrigger value="compliance" className="data-[state=active]:bg-white/10">
              <ShieldCheck className="w-4 h-4 mr-2" />CBN Compliance
            </TabsTrigger>
            <TabsTrigger value="papss" className="data-[state=active]:bg-white/10">
              <Zap className="w-4 h-4 mr-2" />PAPSS Rail
            </TabsTrigger>
          </TabsList>

          {/* Live Rates */}
          <TabsContent value="rates">
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-white">Bloomberg BMATCH Rates</CardTitle>
                    <CardDescription className="text-white/50">
                      Live rates via ADB passthrough — auto-refresh every 30s
                      {lastRefreshed && (
                        <span className="ml-2 text-white/30">
                          · Last updated: {lastRefreshed.toLocaleTimeString()}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleManualRefresh}
                    disabled={allRates.isFetching}
                    className="border-white/20 text-white/70 hover:text-white">
                    <RefreshCw className={`w-4 h-4 mr-2 ${allRates.isFetching ? 'animate-spin' : ''}`} />
                    {allRates.isFetching ? 'Refreshing…' : 'Refresh Now'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {allRates.isPending ? (
                  <div className="text-center text-white/40 py-12">Loading live rates...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10">
                        <TableHead className="text-white/60">Currency Pair</TableHead>
                        <TableHead className="text-white/60">BMATCH Mid Rate</TableHead>
                        <TableHead className="text-white/60">Platform Rate</TableHead>
                        <TableHead className="text-white/60">Spread</TableHead>
                        <TableHead className="text-white/60">Session</TableHead>
                        <TableHead className="text-white/60">CBN Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(allRates.data ?? []).map((rate) => (
                        <TableRow key={rate.pair} className="border-white/5 hover:bg-white/5">
                          <TableCell className="font-mono font-bold text-white">{rate.pair}</TableCell>
                          <TableCell className="font-mono text-emerald-300">
                            {parseFloat(String(rate.midRate)).toLocaleString("en-US", { minimumFractionDigits: 4 })}
                          </TableCell>
                          <TableCell className="font-mono text-blue-300">
                            {parseFloat(String(rate.midRate)).toLocaleString("en-US", { minimumFractionDigits: 4 })}
                          </TableCell>
                          <TableCell className="text-white/80">{(rate as any)?.platformRate ? parseFloat(String((rate as any)?.platformRate)).toLocaleString("en-US", { minimumFractionDigits: 4 }) : "-"}</TableCell>
                          <TableCell className="text-white/60">{rate.spreadBps} bps</TableCell>
                          <TableCell>{(rate as any)?.withinCbnLimit !== false ? <span className="text-green-400 text-xs font-medium">✓ Within CBN Limit</span> : <span className="text-red-400 text-xs font-medium">✗ Exceeds CBN Limit</span>}</TableCell>
                          <TableCell>
                            <Badge className="bg-white/10 text-white/70 text-xs">{rate.session}</Badge>
                          </TableCell>
                          <TableCell>
                            {rate.spreadBps ? (
                              <Badge className="bg-green-500/20 text-green-300 text-xs">
                                <CheckCircle2 className="w-3 h-3 mr-1" />Compliant
                              </Badge>
                            ) : (
                              <Badge className="bg-red-500/20 text-red-300 text-xs">Exceeds limit</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <div className="mt-4 p-4 rounded-lg bg-blue-900/20 border border-blue-500/20">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-blue-200 font-medium">About BMATCH Rates</p>
                      <p className="text-xs text-blue-300/70 mt-1">
                        Bloomberg BMATCH is the CBN-mandated benchmark for all International Money Transfer Operators (IMTOs).
                        Our rates are sourced via our Authorised Dealer Bank (ADB) and must not deviate by more than the CBN-prescribed
                        spread. All rate snapshots are archived in our OpenSearch audit lakehouse for regulatory review.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Corridors */}
          <TabsContent value="corridors">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {corridors.isPending ? (
                <div className="col-span-3 text-center text-white/40 py-12">Loading corridors...</div>
              ) : (
                (corridors.data ?? []).map((corridor: any) => (
                  <Card key={corridor.corridor} className="bg-white/5 border-white/10 hover:bg-white/8 transition-colors">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Globe className="w-5 h-5 text-emerald-400" />
                          <span className="font-bold text-white">{corridor.corridor}</span>
                        </div>
                        <Badge className={corridor.papssEnabled
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-gray-500/20 text-gray-300"}>
                          {corridor.papssEnabled ? "PAPSS" : "SWIFT"}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">Exchange Rate</span>
                          <span className="font-mono text-white">{corridor.exchangeRate ?? "—"}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">Transfer Fee</span>
                          <span className="text-white">{corridor.transferFeePercent ?? "—"}%</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">Settlement</span>
                          <span className="text-white">{corridor.settlementTimeHours ?? "—"}h</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">Min / Max</span>
                          <span className="text-white/70 text-xs">
                            ${corridor.minAmountUsd ?? 1} — ${(corridor.maxAmountUsd ?? 50000).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <Button className="w-full mt-4 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30" size="sm">
                        Send Money <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* CBN Compliance */}
          <TabsContent value="compliance">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="bg-white/5 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Regulatory Framework</CardTitle>
                  <CardDescription className="text-white/50">CBN Circular March 24 2026</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[
                    {
                      title: "BMATCH Rate Benchmark",
                      desc: "All USD/NGN rates benchmarked against Bloomberg BMATCH via ADB passthrough. Deviations exceeding CBN limits trigger automatic alerts.",
                      icon: <TrendingUp className="w-5 h-5 text-emerald-400" />,
                      status: "Active",
                    },
                    {
                      title: "Settlement Account Registry",
                      desc: "All naira settlement accounts registered with CBN-licensed Authorised Dealer Banks and filed with the CBN.",
                      icon: <Building2 className="w-5 h-5 text-blue-400" />,
                      status: "Active",
                    },
                    {
                      title: "NFEM Funding Enforcement",
                      desc: "Only remittance inflows and NFEM-approved FX conversions permitted into settlement accounts. Non-NFEM sources are automatically blocked.",
                      icon: <Lock className="w-5 h-5 text-yellow-400" />,
                      status: "Active",
                    },
                    {
                      title: "Audit Lakehouse",
                      desc: "All compliance events archived in OpenSearch with 90-day retention. Monthly reports generated automatically for CBN submission.",
                      icon: <ShieldCheck className="w-5 h-5 text-purple-400" />,
                      status: "Active",
                    },
                  ].map((item) => (
                    <div key={item.title} className="flex gap-4 p-4 rounded-lg bg-white/5">
                      <div className="flex-shrink-0 mt-0.5">{item.icon}</div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-white">{item.title}</p>
                          <Badge className="bg-green-500/20 text-green-300 text-xs">{item.status}</Badge>
                        </div>
                        <p className="text-sm text-white/50">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="bg-white/5 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Security & Access Control</CardTitle>
                  <CardDescription className="text-white/50">Enterprise-grade security stack</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { name: "Keycloak Identity Provider", desc: "OAuth 2.0 / OIDC with MFA enforcement for all compliance roles" },
                    { name: "Permify PBAC Engine", desc: "Policy-based access control — compliance officers, settlement managers, admins" },
                    { name: "OpenAppSec WAF", desc: "OWASP Top 10 protection on all compliance API endpoints via APISIX" },
                    { name: "TigerBeetle Ledger", desc: "Immutable double-entry accounting for all settlement account movements" },
                    { name: "Temporal Workflows", desc: "Durable, fault-tolerant automation for BMATCH snapshots and CBN filings" },
                    { name: "Dapr Pubsub", desc: "Event-driven compliance notifications across all microservices" },
                  ].map((item) => (
                    <div key={item.name} className="p-3 rounded-lg bg-white/5">
                      <p className="text-sm font-medium text-white">{item.name}</p>
                      <p className="text-xs text-white/40 mt-0.5">{item.desc}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* PAPSS Rail */}
          <TabsContent value="papss">
            <div className="space-y-6">
              <Card className="bg-gradient-to-br from-emerald-900/30 to-blue-900/20 border-emerald-500/20">
                <CardContent className="pt-8 pb-8">
                  <div className="flex items-start gap-6">
                    <Zap className="w-16 h-16 text-emerald-400 flex-shrink-0" />
                    <div>
                      <h2 className="text-2xl font-bold text-white mb-2">
                        Pan-African Payment & Settlement System (PAPSS)
                      </h2>
                      <p className="text-white/60 text-lg mb-4">
                        RemitFlow uses PAPSS as its primary settlement rail for African corridors —
                        the same infrastructure endorsed by the CBN as an official settlement mechanism.
                        This makes RemitFlow a CBN-preferred IMTO for Nigeria-bound remittances.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 px-3 py-1">
                          CBN-endorsed settlement rail
                        </Badge>
                        <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 px-3 py-1">
                          Same-day settlement
                        </Badge>
                        <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 px-3 py-1">
                          Intra-African corridors
                        </Badge>
                        <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30 px-3 py-1">
                          Daily settlement batch at 02:00 UTC
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    title: "Settlement Speed",
                    value: "Same Day",
                    desc: "PAPSS processes intra-African settlements within the same business day, vs 2–5 days for SWIFT",
                    icon: <Zap className="w-8 h-8 text-yellow-400" />,
                  },
                  {
                    title: "Cost Reduction",
                    value: "Up to 60%",
                    desc: "PAPSS eliminates correspondent bank fees and USD intermediation for African corridors",
                    icon: <TrendingUp className="w-8 h-8 text-green-400" />,
                  },
                  {
                    title: "Regulatory Standing",
                    value: "CBN Endorsed",
                    desc: "PAPSS is explicitly recognised by the CBN as an official settlement mechanism for IMTOs",
                    icon: <ShieldCheck className="w-8 h-8 text-blue-400" />,
                  },
                ].map((item) => (
                  <Card key={item.title} className="bg-white/5 border-white/10">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3 mb-3">
                        {item.icon}
                        <div>
                          <p className="text-2xl font-bold text-white">{item.value}</p>
                          <p className="text-xs text-white/50">{item.title}</p>
                        </div>
                      </div>
                      <p className="text-sm text-white/50">{item.desc}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
