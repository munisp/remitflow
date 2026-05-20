import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Phone, Zap, Shield, ShoppingBag } from "lucide-react";

export default function CrossSellMarketplace() {
  const [airtimeForm, setAirtimeForm] = useState({ providerId: "", phoneNumber: "", amount: "" });
  const [billForm, setBillForm] = useState({ billTypeId: "", accountNumber: "", amount: "" });
  const [insuranceProductId, setInsuranceProductId] = useState("");
  const [airtimeOpen, setAirtimeOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [insuranceOpen, setInsuranceOpen] = useState(false);

  const { data: catalog, isLoading } = trpc.crossSell.catalog.useQuery();
  const { data: myProducts } = trpc.crossSell.myProducts.useQuery({ page: 1, limit: 20 });

  const airtimeMutation = trpc.crossSell.airtimeTopup.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setAirtimeOpen(false);
      setAirtimeForm({ providerId: "", phoneNumber: "", amount: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const billMutation = trpc.crossSell.billPayment.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setBillOpen(false);
      setBillForm({ billTypeId: "", accountNumber: "", amount: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const insuranceMutation = trpc.crossSell.microInsurance.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setInsuranceOpen(false);
      setInsuranceProductId("");
    },
    onError: (e) => toast.error(e.message),
  });

  const fmt = (n: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n);

  if (isLoading) return <div className="p-6"><div className="h-64 bg-muted animate-pulse rounded-lg" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">Marketplace</h1>
        <p className="text-muted-foreground mt-1">Airtime top-up, bill payments, and micro-insurance for your recipients</p>
      </div>

      <Tabs defaultValue="airtime">
        <TabsList>
          <TabsTrigger value="airtime"><Phone className="w-4 h-4 mr-2" />Airtime</TabsTrigger>
          <TabsTrigger value="bills"><Zap className="w-4 h-4 mr-2" />Bills</TabsTrigger>
          <TabsTrigger value="insurance"><Shield className="w-4 h-4 mr-2" />Insurance</TabsTrigger>
          <TabsTrigger value="history"><ShoppingBag className="w-4 h-4 mr-2" />My Orders</TabsTrigger>
        </TabsList>

        {/* Airtime */}
        <TabsContent value="airtime" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog?.airtime?.map((p: any) => (
              <Card key={p.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold">{p.name}</div>
                    <Badge variant="outline">{p.country}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mb-1">Min: {p.minAmount} {p.currency}</div>
                  <div className="text-sm text-muted-foreground mb-3">Max: {p.maxAmount.toLocaleString()} {p.currency}</div>
                  <div className="text-xs text-green-600 mb-4">Commission: {(p.commissionRate * 100).toFixed(1)}%</div>
                  <Dialog open={airtimeOpen && airtimeForm.providerId === p.id} onOpenChange={(o) => { setAirtimeOpen(o); if (o) setAirtimeForm(f => ({ ...f, providerId: p.id })); }}>
                    <DialogTrigger asChild>
                      <Button className="w-full" size="sm" onClick={() => { setAirtimeForm(f => ({ ...f, providerId: p.id })); setAirtimeOpen(true); }}>Top Up</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Airtime Top-Up — {p.name}</DialogTitle></DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Phone Number</Label>
                          <Input placeholder="+234..." value={airtimeForm.phoneNumber} onChange={e => setAirtimeForm(f => ({ ...f, phoneNumber: e.target.value }))} />
                        </div>
                        <div>
                          <Label>Amount ({p.currency})</Label>
                          <Input type="number" placeholder={`${p.minAmount}–${p.maxAmount}`} value={airtimeForm.amount} onChange={e => setAirtimeForm(f => ({ ...f, amount: e.target.value }))} />
                        </div>
                        <Button className="w-full" disabled={airtimeMutation.isPending} onClick={() => airtimeMutation.mutate({ providerId: p.id, phoneNumber: airtimeForm.phoneNumber, amount: Number(airtimeForm.amount), currency: p.currency })}>
                          {airtimeMutation.isPending ? "Processing..." : `Send ${airtimeForm.amount || 0} ${p.currency}`}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Bills */}
        <TabsContent value="bills" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog?.bills?.map((b: any) => (
              <Card key={b.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold">{b.name}</div>
                    <Badge variant="secondary">{b.category}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mb-4">Service fee: {fmt(b.fee)}</div>
                  <Dialog open={billOpen && billForm.billTypeId === b.id} onOpenChange={(o) => { setBillOpen(o); if (o) setBillForm(f => ({ ...f, billTypeId: b.id })); }}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="w-full" size="sm" onClick={() => { setBillForm(f => ({ ...f, billTypeId: b.id })); setBillOpen(true); }}>Pay Bill</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Pay {b.name}</DialogTitle></DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Account / Meter Number</Label>
                          <Input placeholder="Account number" value={billForm.accountNumber} onChange={e => setBillForm(f => ({ ...f, accountNumber: e.target.value }))} />
                        </div>
                        <div>
                          <Label>Amount (NGN)</Label>
                          <Input type="number" placeholder="Amount" value={billForm.amount} onChange={e => setBillForm(f => ({ ...f, amount: e.target.value }))} />
                        </div>
                        <div className="text-sm text-muted-foreground">Service fee: {fmt(b.fee)}</div>
                        <Button className="w-full" disabled={billMutation.isPending} onClick={() => billMutation.mutate({ billTypeId: b.id, accountNumber: billForm.accountNumber, amount: Number(billForm.amount) })}>
                          {billMutation.isPending ? "Processing..." : `Pay ${billForm.amount ? fmt(Number(billForm.amount)) : "Bill"}`}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Insurance */}
        <TabsContent value="insurance" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog?.insurance?.map((ins: any) => (
              <Card key={ins.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">{ins.name}</div>
                    <Badge variant="outline" className="capitalize">{ins.type}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mb-1">Coverage: {fmt(ins.coverageAmount)}</div>
                  <div className="text-sm text-muted-foreground mb-1">Duration: {ins.durationDays} days</div>
                  <div className="text-lg font-bold text-primary mt-3 mb-4">{fmt(ins.premium)} <span className="text-sm font-normal text-muted-foreground">premium</span></div>
                  <Dialog open={insuranceOpen && insuranceProductId === ins.id} onOpenChange={(o) => { setInsuranceOpen(o); if (o) setInsuranceProductId(ins.id); }}>
                    <DialogTrigger asChild>
                      <Button className="w-full" size="sm" onClick={() => { setInsuranceProductId(ins.id); setInsuranceOpen(true); }}>Get Covered</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Enroll in {ins.name}</DialogTitle></DialogHeader>
                      <div className="space-y-3 text-sm">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="text-muted-foreground">Coverage</div><div className="font-semibold">{fmt(ins.coverageAmount)}</div>
                          <div className="text-muted-foreground">Duration</div><div className="font-semibold">{ins.durationDays} days</div>
                          <div className="text-muted-foreground">Premium</div><div className="font-semibold">{fmt(ins.premium)}</div>
                          <div className="text-muted-foreground">Platform fee</div><div className="font-semibold">{fmt(ins.platformFee)}</div>
                        </div>
                        <Button className="w-full mt-4" disabled={insuranceMutation.isPending} onClick={() => insuranceMutation.mutate({ productId: ins.id })}>
                          {insuranceMutation.isPending ? "Enrolling..." : `Enroll — ${fmt(ins.premium)}`}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* My Orders */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader><CardTitle>My Orders</CardTitle></CardHeader>
            <CardContent>
              {!myProducts?.products?.length ? (
                <div className="text-center py-12 text-muted-foreground">No orders yet. Start with an airtime top-up!</div>
              ) : (
                <div className="space-y-3">
                  {myProducts.products.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-sm text-muted-foreground">{p.detail} · {new Date(p.createdAt || p.created_at).toLocaleDateString()}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">{p.amount?.toLocaleString()} {p.currency}</div>
                        <Badge variant={p.status === "COMPLETED" || p.status === "ACTIVE" ? "default" : "secondary"} className="text-xs">{p.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
