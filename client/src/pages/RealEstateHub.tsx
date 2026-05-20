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
  Home, MapPin, TrendingUp, Users, DollarSign, Search,
  Building2, Percent, Calendar, AlertCircle, ChevronRight, RefreshCw, Eye
} from "lucide-react";

function formatNGN(val: string | number | null | undefined) {
  if (!val) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (n >= 1e9) return `₦${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `₦${(n / 1e6).toFixed(2)}M`;
  return `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;
}

function formatUSD(val: string | number | null | undefined) {
  if (!val) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const PROPERTY_TYPES = ["all", "residential", "commercial", "land", "mixed_use", "industrial"];
const CITIES = ["all", "Lagos", "Abuja", "Port Harcourt", "Kano", "Ibadan", "Enugu", "Kaduna"];

export default function RealEstateHub() {
  const [tab, setTab] = useState("listings");
  const [search, setSearch] = useState("");
  const [propertyType, setPropertyType] = useState("all");
  const [city, setCity] = useState("all");
  const [selectedListing, setSelectedListing] = useState<number | null>(null);
  const [investDialog, setInvestDialog] = useState(false);
  const [investAmount, setInvestAmount] = useState("");
  const [sharesCount, setSharesCount] = useState(1);

  const { data: listings, isLoading, refetch } = trpc.realEstate.listListings.useQuery({
    search: search || undefined,
    propertyType: propertyType === "all" ? undefined : propertyType,
    city: city === "all" ? undefined : city,
    limit: 50,
  });

  const { data: myInvestments } = trpc.realEstate.getMyInvestments.useQuery();
  const { data: selectedProperty } = trpc.realEstate.getListing.useQuery(
    { id: selectedListing! },
    { enabled: !!selectedListing }
  );

  const invest = trpc.realEstate.invest.useMutation({
    onSuccess: () => {
      setInvestDialog(false);
      toast.success("Investment confirmed! Funds will be transferred within 24 hours.");
    },
    onError: (e) => toast.error(e.message),
  });

  const totalInvested = myInvestments?.reduce((s: any, i: any) => s + parseFloat(i.amountUsd ?? "0"), 0) ?? 0;
  const totalNGNInvested = myInvestments?.reduce((s: any, i: any) => s + parseFloat(i.amountNgn ?? "0"), 0) ?? 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Home className="h-6 w-6 text-blue-500" />
              Nigerian Real Estate Hub
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Fractional and full property investment in Nigeria — from anywhere in the world
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>

        {/* Stats Row */}
        {myInvestments && myInvestments.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Total Invested (USD)</p>
                <p className="text-2xl font-bold text-blue-600">{formatUSD(totalInvested)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Total Invested (NGN)</p>
                <p className="text-2xl font-bold">{formatNGN(totalNGNInvested)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Properties Owned</p>
                <p className="text-2xl font-bold">{myInvestments.length}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Info Banner */}
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="pt-4 pb-3">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-blue-700 dark:text-blue-400">Diaspora Real Estate Investment</p>
                <p className="text-muted-foreground mt-1">
                  Invest in Nigerian real estate from as little as $500 through fractional ownership. 
                  Properties are managed by licensed Nigerian estate agents. Rental income is paid quarterly 
                  in USD to your RemitFlow wallet. Title deeds are held in trust by SEC-registered trustees.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="listings">Available Properties</TabsTrigger>
            <TabsTrigger value="portfolio">
              My Portfolio {myInvestments && myInvestments.length > 0 && (
                <Badge className="ml-1 h-4 px-1 text-xs">{myInvestments.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="howto">How It Works</TabsTrigger>
          </TabsList>

          {/* Listings Tab */}
          <TabsContent value="listings" className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search properties..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Property Type" />
                </SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t === "all" ? "All Types" : t.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="City" />
                </SelectTrigger>
                <SelectContent>
                  {CITIES.map((c) => (
                    <SelectItem key={c} value={c}>{c === "all" ? "All Cities" : c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i}><CardContent className="pt-4"><Skeleton className="h-48 w-full" /></CardContent></Card>
                ))}
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {listings?.map((prop: any) => {
                  const fundedPct = prop.totalValueNgn && prop.fundedAmountNgn
                    ? Math.min(100, (parseFloat(prop.fundedAmountNgn) / parseFloat(prop.totalValueNgn)) * 100)
                    : 0;
                  return (
                    <Card key={prop.id} className="hover:shadow-lg transition-shadow cursor-pointer group">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-base group-hover:text-blue-600 transition-colors">
                              {prop.title}
                            </CardTitle>
                            <CardDescription className="flex items-center gap-1 mt-1">
                              <MapPin className="h-3 w-3" />
                              {prop.city}, {prop.state}
                            </CardDescription>
                          </div>
                          <Badge variant="outline" className="text-xs capitalize shrink-0">
                            {prop.propertyType?.replace("_", " ")}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <p className="text-muted-foreground text-xs">Total Value</p>
                            <p className="font-bold">{formatNGN(prop.totalValueNgn)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Min. Investment</p>
                            <p className="font-bold text-blue-600">{formatUSD(prop.minInvestmentUsd)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Expected ROI</p>
                            <p className="font-bold text-emerald-600 flex items-center gap-1">
                              <TrendingUp className="h-3 w-3" />
                              {prop.expectedRoiPercent ? `${parseFloat(prop.expectedRoiPercent).toFixed(1)}%` : "—"} p.a.
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Rental Yield</p>
                            <p className="font-bold flex items-center gap-1">
                              <Percent className="h-3 w-3" />
                              {prop.rentalYieldPercent ? `${parseFloat(prop.rentalYieldPercent).toFixed(1)}%` : "—"} p.a.
                            </p>
                          </div>
                        </div>

                        {/* Funding Progress */}
                        <div>
                          <div className="flex justify-between text-xs text-muted-foreground mb-1">
                            <span>Funded</span>
                            <span>{fundedPct.toFixed(0)}%</span>
                          </div>
                          <Progress value={fundedPct} className="h-2" />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{prop.investorCount ?? 0} investors</span>
                            <span>{formatNGN(prop.fundedAmountNgn)} raised</span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => setSelectedListing(prop.id)}
                          >
                            <Eye className="h-3 w-3 mr-1" />Details
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                            disabled={prop.status !== "active"}
              onClick={() => {
                        setSelectedListing(prop.id);
                        setSharesCount(1);
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
                {(!listings || listings.length === 0) && (
                  <div className="col-span-3 text-center py-16 text-muted-foreground">
                    <Home className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No properties found matching your criteria</p>
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
                  <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-muted-foreground">No investments yet. Browse available properties to get started.</p>
                  <Button className="mt-4" onClick={() => setTab("listings")}>Browse Properties</Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {myInvestments.map((inv: any) => (
                  <Card key={inv.id}>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{inv.propertyTitle}</p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{inv.city}, {inv.state}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-blue-600">{formatUSD(inv.amountUsd)}</p>
                          <p className="text-sm text-muted-foreground">{formatNGN(inv.amountNgn)}</p>
                        </div>
                        <div className="text-right">
                          <Badge variant={inv.status === "active" ? "default" : "secondary"} className="capitalize">
                            {inv.status}
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-1">
                            {inv.ownershipPercent ? `${parseFloat(inv.ownershipPercent).toFixed(4)}%` : ""} ownership
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="text-muted-foreground">Invested</p>
                          <p>{new Date(inv.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* How It Works Tab */}
          <TabsContent value="howto" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              {[
                {
                  step: "1",
                  title: "Browse & Select",
                  body: "Browse verified Nigerian properties. Each listing shows expected ROI, rental yield, location, and funding progress. All properties are verified by licensed Nigerian estate agents.",
                },
                {
                  step: "2",
                  title: "Invest from $500",
                  body: "Invest from as little as $500 USD. Funds are converted to NGN at the live rate and held in an escrow account by a CBN-licensed trustee until the property is fully funded.",
                },
                {
                  step: "3",
                  title: "Earn Rental Income",
                  body: "Once the property is funded and tenanted, rental income is distributed quarterly to your RemitFlow wallet in USD. You can reinvest or withdraw at any time.",
                },
                {
                  step: "4",
                  title: "Exit & Capital Gains",
                  body: "Properties are typically held for 3–7 years. At exit, proceeds (capital gains + your principal) are distributed in USD. You can also sell your fractional stake on the secondary market.",
                },
              ].map((item) => (
                <Card key={item.step}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-3">
                      <span className="h-7 w-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                        {item.step}
                      </span>
                      {item.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{item.body}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="pt-4 pb-3">
                <p className="font-medium text-amber-700 dark:text-amber-400 text-sm">Risk Disclosure</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Real estate investments are illiquid and subject to market risk, currency risk (NGN/USD), 
                  and regulatory risk. Past performance is not indicative of future results. 
                  Returns are not guaranteed. Consult a financial advisor before investing.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Property Detail Dialog */}
      {selectedProperty && !investDialog && (
        <Dialog open={!!selectedListing} onOpenChange={() => setSelectedListing(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedProperty.title}</DialogTitle>
              <DialogDescription className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />{selectedProperty.city}, {selectedProperty.state}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{selectedProperty.description}</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: "Total Value", value: formatNGN(selectedProperty.totalValueNgn) },
                  { label: "Min Investment", value: formatUSD(selectedProperty.minInvestmentUsd) },
                  { label: "Expected ROI", value: selectedProperty.expectedRoiPercent ? `${parseFloat(selectedProperty.expectedRoiPercent).toFixed(1)}% p.a.` : "—" },
                  { label: "Rental Yield", value: selectedProperty.rentalYieldPercent ? `${parseFloat(selectedProperty.rentalYieldPercent).toFixed(1)}% p.a.` : "—" },
                  { label: "Property Type", value: selectedProperty.propertyType?.replace("_", " ") ?? "—" },
                  { label: "Status", value: selectedProperty.status ?? "—" },
                ].map((item) => (
                  <div key={item.label} className="p-2 bg-muted/30 rounded">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="font-semibold capitalize">{item.value}</p>
                  </div>
                ))}
              </div>
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => {
                  setSharesCount(1);
                  setInvestDialog(true);
                }}
              >
                Invest in This Property <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Investment Dialog */}
      <Dialog open={investDialog} onOpenChange={setInvestDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invest in Property</DialogTitle>
            <DialogDescription>{selectedProperty?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
            <Label>Number of Shares</Label>
            <Input
              type="number"
              min={1}
              value={sharesCount}
              onChange={(e) => setSharesCount(parseInt(e.target.value) || 1)}
              placeholder="e.g. 10"
            />
            {selectedProperty?.pricePerShareUsd && (
              <p className="text-xs text-muted-foreground mt-1">
                {formatUSD(parseFloat(selectedProperty.pricePerShareUsd) * sharesCount)} total
                (₦{(parseFloat(selectedProperty.pricePerShareUsd) * sharesCount * 1600).toLocaleString()} NGN)
              </p>
            )}
            </div>
            {selectedProperty && (
              <div className="p-3 bg-muted/30 rounded-lg text-sm space-y-1">
              <div className="flex justify-between">
                    <span className="text-muted-foreground">Ownership stake</span>
                    <span className="font-mono">
                      {selectedProperty.totalShares
                        ? `${(sharesCount / selectedProperty.totalShares * 100).toFixed(4)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Price per share</span>
                    <span className="font-mono text-emerald-600">
                      {selectedProperty.pricePerShareUsd ? formatUSD(selectedProperty.pricePerShareUsd) : "—"}
                    </span>
                  </div>
              </div>
            )}
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              disabled={invest.isPending || sharesCount < 1}
              onClick={() =>
                invest.mutate({
                  listingId: selectedListing!,
                  sharesCount,
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
