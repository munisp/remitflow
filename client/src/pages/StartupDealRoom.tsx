import { useTranslation } from 'react-i18next';
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Rocket, Search, TrendingUp, Users, DollarSign, AlertCircle,
  Building2, Globe, Briefcase, ChevronRight, RefreshCw, Zap, Target
} from "lucide-react";

function formatUSD(val: string | number | null | undefined) {
  if (!val) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const STAGES = ["all", "pre_seed", "seed", "series_a", "series_b", "growth"];
const SECTORS = ["all", "Fintech", "Healthtech", "Agritech", "Edtech", "Logistics", "E-commerce", "Energy", "SaaS"];

const STAGE_COLORS: Record<string, string> = {
  pre_seed: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  seed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  series_a: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  series_b: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  growth: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

export default function StartupDealRoom() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("deals");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [sector, setSector] = useState("all");
  const [selectedDeal, setSelectedDeal] = useState<number | null>(null);
  const [investDialog, setInvestDialog] = useState(false);
  const [investAmount, setInvestAmount] = useState("1000");

  const { data: deals, isLoading, refetch } = trpc.startups.listDeals.useQuery({
    search: search || undefined,
    stage: stage === "all" ? undefined : stage,
    sector: sector === "all" ? undefined : sector,
    limit: 50,
  });

  const { data: myInvestments } = trpc.startups.getMyInvestments.useQuery();
  const { data: selectedDealData } = trpc.startups.getDeal.useQuery(
    { id: selectedDeal! },
    { enabled: !!selectedDeal }
  );

  const invest = trpc.startups.commit.useMutation({
    onSuccess: () => {
      setInvestDialog(false);
      toast.success("Investment confirmed! Welcome to the cap table.");
    },
    onError: (e) => toast.error(e.message),
  });

  const totalInvested = myInvestments?.reduce((s: any, i: any) => s + parseFloat(i.amountUsd ?? "0"), 0) ?? 0;
  const activeDeals = myInvestments?.filter((i: any) => i.status === "active").length ?? 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Rocket className="h-6 w-6 text-purple-500" />
              Nigerian Startup Deal Room
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Invest in vetted Nigerian startups — from pre-seed to growth stage
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>

        {/* Portfolio Stats */}
        {myInvestments && myInvestments.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Total Deployed</p>
                <p className="text-2xl font-bold text-purple-600">{formatUSD(totalInvested)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Active Investments</p>
                <p className="text-2xl font-bold">{activeDeals}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Portfolio Companies</p>
                <p className="text-2xl font-bold">{myInvestments.length}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Info Banner */}
        <Card className="border-purple-500/30 bg-purple-500/5">
          <CardContent className="pt-4 pb-3">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-purple-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-purple-700 dark:text-purple-400">Diaspora Startup Investing</p>
                <p className="text-muted-foreground mt-1">
                  All deals are vetted by RemitFlow's investment committee. Investments are structured as 
                  SAFE notes or equity rounds. Minimum ticket sizes start at $1,000. 
                  Startups are registered with the CAC (Corporate Affairs Commission, Nigeria).
                  Returns are realized at exit (acquisition, IPO, or secondary sale).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="deals">Live Deals</TabsTrigger>
            <TabsTrigger value="portfolio">
              My Portfolio {myInvestments && myInvestments.length > 0 && (
                <Badge className="ml-1 h-4 px-1 text-xs">{myInvestments.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="ecosystem">Nigerian Ecosystem</TabsTrigger>
          </TabsList>

          {/* Deals Tab */}
          <TabsContent value="deals" className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search startups..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Stage" />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{s === "all" ? "All Stages" : s.replace("_", " ").toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Sector" />
                </SelectTrigger>
                <SelectContent>
                  {SECTORS.map((s) => (
                    <SelectItem key={s} value={s}>{s === "all" ? "All Sectors" : s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="grid md:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}><CardContent className="pt-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
                ))}
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {deals?.map((deal: any) => {
                  const raisedPct = deal.targetRaiseUsd && deal.raisedSoFarUsd
                    ? Math.min(100, (parseFloat(deal.raisedSoFarUsd) / parseFloat(deal.targetRaiseUsd)) * 100)
                    : 0;
                  const stageClass = STAGE_COLORS[deal.stage ?? "seed"] ?? "bg-gray-100 text-gray-700";
                  return (
                    <Card key={deal.id} className="hover:shadow-lg transition-shadow">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-lg">{deal.companyName}</CardTitle>
                            <CardDescription className="mt-1">{deal.tagline}</CardDescription>
                          </div>
                          <Badge className={`text-xs capitalize shrink-0 ${stageClass}`}>
                            {deal.stage?.replace("_", " ")}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-1">
                          {deal.sector && <Badge variant="outline" className="text-xs">{deal.sector}</Badge>}
                          {deal.location && <Badge variant="outline" className="text-xs flex items-center gap-1"><Building2 className="h-2 w-2" />{deal.location}</Badge>}
                          {deal.foundedYear && <Badge variant="outline" className="text-xs">Est. {deal.foundedYear}</Badge>}
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <p className="text-muted-foreground text-xs">Valuation</p>
                            <p className="font-bold">{formatUSD(deal.valuationUsd)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Target Raise</p>
                            <p className="font-bold text-purple-600">{formatUSD(deal.targetRaiseUsd)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Min Ticket</p>
                            <p className="font-bold">{formatUSD(deal.minimumTicketUsd)}</p>
                          </div>
                        </div>

                        {/* Raise Progress */}
                        <div>
                          <div className="flex justify-between text-xs text-muted-foreground mb-1">
                            <span>Raised</span>
                            <span>{raisedPct.toFixed(0)}% of target</span>
                          </div>
                          <Progress value={raisedPct} className="h-2" />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{formatUSD(deal.raisedSoFarUsd)} raised</span>
                            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{deal.investorCount ?? 0} investors</span>
                          </div>
                        </div>

                        {deal.metrics && deal.metrics.length > 0 && (
                          <p className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
                            📊 {deal.metrics.map((m: any) => `${m.label}: ${m.value}`).join(" · ")}
                          </p>
                        )}

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => setSelectedDeal(deal.id)}
                          >
                            View Details
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                            disabled={deal.status !== "open"}
                            onClick={() => {
                              setSelectedDeal(deal.id);
                              setInvestAmount(deal.minimumTicketUsd ?? "1000");
                              setInvestDialog(true);
                            }}
                          >
                            Invest
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {(!deals || deals.length === 0) && (
                  <div className="col-span-2 text-center py-16 text-muted-foreground">
                    <Rocket className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No deals found matching your criteria</p>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* Portfolio Tab */}
          <TabsContent value="portfolio" className="space-y-4">
            {!myInvestments || myInvestments.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Briefcase className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-muted-foreground">No investments yet. Browse live deals to get started.</p>
                  <Button className="mt-4 bg-purple-600 hover:bg-purple-700 text-white" onClick={() => setTab("deals")}>
                    Browse Deals
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {myInvestments.map((inv: any) => (
                  <Card key={inv.id}>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div>
                          <p className="font-semibold">{inv.companyName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">{inv.sector}</Badge>
                            <Badge className={`text-xs capitalize ${STAGE_COLORS[inv.stage ?? "seed"] ?? ""}`}>
                              {inv.stage?.replace("_", " ")}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-purple-600">{formatUSD(inv.amountUsd)}</p>
                          <p className="text-xs text-muted-foreground">{inv.instrumentType?.toUpperCase()}</p>
                        </div>
                        <div className="text-right">
                          <Badge variant={inv.status === "active" ? "default" : "secondary"} className="capitalize">
                            {inv.status}
                          </Badge>
                          {inv.equityPct && (
                            <p className="text-xs text-muted-foreground mt-1">{parseFloat(inv.equityPct).toFixed(4)}% equity</p>
                          )}
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                          {new Date(inv.investedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Ecosystem Tab */}
          <TabsContent value="ecosystem" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              {[
                {
                  icon: Zap,
                  title: "Why Nigerian Startups?",
                  body: "Nigeria is Africa's largest startup ecosystem with $1.8B+ raised in 2023. Lagos is home to unicorns like Flutterwave, Paystack, and Andela. The country's 220M+ population and growing middle class create massive market opportunities.",
                },
                {
                  icon: Target,
                  title: "Investment Structure",
                  body: "Most deals use SAFE notes (Simple Agreement for Future Equity) or priced equity rounds. SAFEs convert to equity at the next priced round. All deals are structured under Nigerian company law with CAC-registered entities.",
                },
                {
                  icon: Globe,
                  title: "Diaspora Advantage",
                  body: "As a diaspora investor, you bring more than capital — your global network, market access, and technical expertise are invaluable to Nigerian startups. Many founders actively seek diaspora investors for their international connections.",
                },
                {
                  icon: TrendingUp,
                  title: "Exit Pathways",
                  body: "Nigerian startups exit via: (1) Acquisition by global companies (e.g., Stripe acquiring Paystack for $200M), (2) NGX IPO listing, (3) Secondary sales on platforms like Oui Capital's secondary market, or (4) Buyback by founders.",
                },
              ].map((item) => (
                <Card key={item.title}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <item.icon className="h-5 w-5 text-purple-500" />
                      {item.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{item.body}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Notable Nigerian Startups */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notable Nigerian Startup Exits & Milestones</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { name: "Paystack", outcome: "Acquired by Stripe for $200M (2020)", stage: "Exit" },
                    { name: "Flutterwave", outcome: "Unicorn — $3B valuation (2022)", stage: "Unicorn" },
                    { name: "Andela", outcome: "Unicorn — $1.5B valuation (2021)", stage: "Unicorn" },
                    { name: "OPay", outcome: "$2B valuation, 35M+ users", stage: "Growth" },
                    { name: "Moniepoint", outcome: "Unicorn — $1B valuation (2023)", stage: "Unicorn" },
                    { name: "Interswitch", outcome: "Unicorn — $1B+ valuation", stage: "Unicorn" },
                  ].map((s) => (
                    <div key={s.name} className="p-3 bg-muted/30 rounded-lg">
                      <p className="font-semibold text-sm">{s.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{s.outcome}</p>
                      <Badge className="mt-2 text-xs" variant="outline">{s.stage}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="pt-4 pb-3">
                <p className="font-medium text-amber-700 dark:text-amber-400 text-sm">Risk Disclosure</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Startup investments are highly illiquid and speculative. Most startups fail. 
                  You should only invest money you can afford to lose entirely. 
                  Past exits (Paystack, etc.) are not indicative of future results.
                  Diversify across multiple deals to manage risk.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Deal Detail Dialog */}
      {selectedDealData && !investDialog && (
        <Dialog open={!!selectedDeal} onOpenChange={() => setSelectedDeal(null)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedDealData.companyName}</DialogTitle>
              <DialogDescription>{selectedDealData.tagline}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {selectedDealData.description && (
                <p className="text-sm text-muted-foreground">{selectedDealData.description}</p>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: "Stage", value: selectedDealData.stage?.replace("_", " ").toUpperCase() },
                  { label: "Sector", value: selectedDealData.sector },
                  { label: "Valuation", value: formatUSD(selectedDealData.valuationUsd) },
                  { label: "Target Raise", value: formatUSD(selectedDealData.targetRaiseUsd) },
                  { label: "Min Ticket", value: formatUSD(selectedDealData.minTicketUsd) },
                  { label: "Instrument", value: selectedDealData.instrumentType?.toUpperCase() },
                  { label: "Founded", value: selectedDealData.foundedYear ?? "—" },
                  { label: "City", value: selectedDealData.location ?? "—" },
                ].map((item) => (
                  <div key={item.label} className="p-2 bg-muted/30 rounded">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="font-semibold capitalize">{item.value ?? "—"}</p>
                  </div>
                ))}
              </div>
              {selectedDealData.metrics && selectedDealData.metrics.length > 0 && (
                <div className="p-3 bg-muted/30 rounded text-sm">
                  <p className="font-medium mb-1">Key Metrics</p>
                  <div className="space-y-1">{selectedDealData.metrics.map((m: any, i: any) => <div key={i} className="flex justify-between text-muted-foreground"><span>{m.label}</span><span className="font-mono">{m.value}</span></div>)}</div>
                </div>
              )}
              {selectedDealData.description && (
                <div className="p-3 bg-muted/30 rounded text-sm">
                  <p className="font-medium mb-1">Use of Funds</p>
                  <p className="text-muted-foreground">{selectedDealData.description}</p>
                </div>
              )}
              <Button
                className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                onClick={() => {
                  setInvestAmount(selectedDealData.minTicketUsd ?? "1000");
                  setInvestDialog(true);
                }}
              >
                Invest in {selectedDealData.companyName} <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Investment Dialog */}
      <Dialog open={investDialog} onOpenChange={setInvestDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invest in Startup</DialogTitle>
            <DialogDescription>{selectedDealData?.startupName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Investment Amount (USD)</Label>
              <Input
                type="number"
                min={selectedDealData?.minimumTicketUsd ?? "1000"}
                value={investAmount}
                onChange={(e) => setInvestAmount(e.target.value)}
                placeholder={`Min: ${formatUSD(selectedDealData?.minimumTicketUsd)}`}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Minimum: {formatUSD(selectedDealData?.minimumTicketUsd)}
              </p>
            </div>
            {selectedDealData && (
              <div className="p-3 bg-muted/30 rounded-lg text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Instrument</span>
                  <span className="font-mono uppercase">{selectedDealData.instrumentType ?? "SAFE"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estimated equity</span>
                  <span className="font-mono">
                    {selectedDealData.valuationUsd
                      ? `${(parseFloat(investAmount || "0") / parseFloat(selectedDealData.valuationUsd) * 100).toFixed(4)}%`
                      : "TBD at conversion"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stage</span>
                  <span className="font-mono capitalize">{selectedDealData.stage?.replace("_", " ")}</span>
                </div>
              </div>
            )}
            <Button
              className="w-full bg-purple-600 hover:bg-purple-700 text-white"
              disabled={invest.isPending || !investAmount || parseFloat(investAmount) < parseFloat(selectedDealData?.minimumTicketUsd ?? "1000")}
              onClick={() =>
                invest.mutate({
                  dealId: selectedDeal!,
                  amountUsd: parseFloat(investAmount),
                  paymentMethod: "wallet",
                })
              }
            >
              {invest.isPending ? "Processing..." : `Confirm Investment of ${formatUSD(investAmount)}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
