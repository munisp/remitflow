import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Smartphone, Zap, CheckCircle2, History } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const networks = [
  { id: "mtn", name: "MTN", color: "bg-yellow-500" },
  { id: "airtel", name: "Airtel", color: "bg-red-500" },
  { id: "glo", name: "Glo", color: "bg-green-600" },
  { id: "9mobile", name: "9mobile", color: "bg-emerald-500" },
];
const quickAmounts = [100, 200, 500, 1000, 2000, 5000];

export default function Airtime() {
  const { t } = useTranslation();
  const [phone, setPhone] = useState("");
  const [network, setNetwork] = useState("mtn");
  const [amount, setAmount] = useState(500);
  const [customAmount, setCustomAmount] = useState("");

  const historyQ = trpc.airtimeV2.history.useQuery({ limit: 20 });
  const buyMutation = trpc.airtimeV2.purchase.useMutation({
    onSuccess: (d) => {
      toast.success(d.message);
      setPhone("");
      setCustomAmount("");
      historyQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const finalAmount = customAmount ? parseFloat(customAmount) : amount;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center">
            <Smartphone className="h-5 w-5 text-yellow-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Buy Airtime</h1>
            <p className="text-muted-foreground text-sm">Top up any Nigerian number instantly</p>
          </div>
        </div>

        <Tabs defaultValue="buy">
          <TabsList>
            <TabsTrigger value="buy"><Zap className="h-4 w-4 mr-1" />Buy Airtime</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-1" />History</TabsTrigger>
          </TabsList>

          <TabsContent value="buy">
            <Card>
              <CardContent className="p-6 space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select Network</label>
                  <div className="grid grid-cols-4 gap-2">
                    {networks.map(n => (
                      <button
                        key={n.id}
                        onClick={() => setNetwork(n.id)}
                        className={"p-3 rounded-xl border-2 text-center transition-all " + (network === n.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")}
                      >
                        <div className={"w-8 h-8 rounded-full mx-auto mb-1 " + n.color} />
                        <div className="text-xs font-medium">{n.name}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Phone Number</label>
                  <Input placeholder="08012345678" value={phone} onChange={e => setPhone(e.target.value)} maxLength={11} />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Amount (₦)</label>
                  <div className="grid grid-cols-3 gap-2">
                    {quickAmounts.map(a => (
                      <button
                        key={a}
                        onClick={() => { setAmount(a); setCustomAmount(""); }}
                        className={"p-2 rounded-lg border text-sm font-medium transition-all " + (amount === a && !customAmount ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50")}
                      >
                        ₦{a.toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <Input
                    type="number"
                    placeholder="Or enter custom amount..."
                    value={customAmount}
                    onChange={e => setCustomAmount(e.target.value)}
                    min={50}
                    max={50000}
                  />
                </div>

                <Button
                  className="w-full"
                  disabled={!phone || !finalAmount || buyMutation.isPending}
                  onClick={() => buyMutation.mutate({ network, phoneNumber: phone, amountNgn: finalAmount, purchaseType: "airtime" })}
                >
                  <Zap className="h-4 w-4 mr-2" />
                  {buyMutation.isPending ? "Processing..." : `Buy ₦${finalAmount.toLocaleString()} Airtime`}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader><CardTitle className="text-base">Recent Purchases</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {historyQ.isPending ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
                ) : (historyQ.data as any[])?.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No purchases yet</p>
                ) : (
                  (historyQ.data as any[])?.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <div>
                          <div className="text-sm font-medium">{p.phone_number}</div>
                          <div className="text-xs text-muted-foreground capitalize">{p.network} · {new Date(p.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-semibold">₦{Number(p.amount_ngn).toLocaleString()}</span>
                        <Badge variant="secondary" className="ml-2 text-xs capitalize">{p.status}</Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
