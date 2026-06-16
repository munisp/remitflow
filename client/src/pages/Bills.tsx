import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Zap, Tv, Wifi, Shield, Droplets, CheckCircle, Clock, AlertCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  electricity: <Zap className="h-5 w-5 text-yellow-500" />,
  tv: <Tv className="h-5 w-5 text-blue-500" />,
  internet: <Wifi className="h-5 w-5 text-green-500" />,
  insurance: <Shield className="h-5 w-5 text-purple-500" />,
  water: <Droplets className="h-5 w-5 text-cyan-500" />,
};

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "electricity", label: "Electricity" },
  { id: "tv", label: "TV" },
  { id: "internet", label: "Internet" },
  { id: "insurance", label: "Insurance" },
  { id: "water", label: "Water" },
];

export default function Bills() {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedBiller, setSelectedBiller] = useState<any>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [validatedAccount, setValidatedAccount] = useState<any>(null);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [step, setStep] = useState<"validate" | "confirm">("validate");

  const { data: billers = [], isLoading } = trpc.billsV2.billers.useQuery(
    { category: selectedCategory === "all" ? undefined : selectedCategory }
  );

  const validateMutation = trpc.billsV2.validateAccount.useMutation({
    onSuccess: (data) => {
      setValidatedAccount(data);
      setStep("confirm");
      if (data.outstandingBalance) setAmount(String(data.outstandingBalance));
    },
    onError: (e) => toast.error(e.message),
  });

  const payMutation = trpc.billsV2.pay.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setPayDialogOpen(false);
      resetForm();
      historyQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const historyQuery = trpc.billsV2.history.useQuery({ limit: 10 });

  const filteredBillers = (billers as any[]).filter(b =>
    search === "" || b.name.toLowerCase().includes(search.toLowerCase())
  );

  function resetForm() {
    setSelectedBiller(null); setAccountNumber(""); setAmount(""); setValidatedAccount(null); setStep("validate");
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Bill Payments</h1>
          <p className="text-muted-foreground">Pay electricity, TV, internet, insurance, and water bills</p>
        </div>

        <Tabs defaultValue="pay">
          <TabsList>
            <TabsTrigger value="pay">Pay Bills</TabsTrigger>
            <TabsTrigger value="history">Payment History</TabsTrigger>
          </TabsList>

          <TabsContent value="pay" className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map(cat => (
                <Button key={cat.id} variant={selectedCategory === cat.id ? "default" : "outline"} size="sm" onClick={() => setSelectedCategory(cat.id)}>{cat.label}</Button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search billers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(8)].map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {filteredBillers.map((biller: any) => (
                  <Card key={biller.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => { setSelectedBiller(biller); setStep("validate"); setPayDialogOpen(true); }}>
                    <CardContent className="p-4 flex flex-col items-center text-center gap-2">
                      <div className="text-2xl">{biller.logo}</div>
                      {CATEGORY_ICONS[biller.category]}
                      <p className="text-sm font-medium leading-tight">{biller.name}</p>
                      <Badge variant="outline" className="text-xs capitalize">{biller.category}</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader><CardTitle>Recent Payments</CardTitle><CardDescription>Your last 10 bill payments</CardDescription></CardHeader>
              <CardContent>
                {historyQuery.isPending ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
                ) : (historyQuery.data as any[])?.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No bill payments yet</p>
                ) : (
                  <div className="space-y-2">
                    {(historyQuery.data as any[])?.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          {p.status === "completed" ? <CheckCircle className="h-4 w-4 text-green-500" /> : p.status === "pending" ? <Clock className="h-4 w-4 text-yellow-500" /> : <AlertCircle className="h-4 w-4 text-red-500" />}
                          <div>
                            <p className="font-medium text-sm">{p.biller_name}</p>
                            <p className="text-xs text-muted-foreground">{p.account_number} · {new Date(p.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">₦{Number(p.amount_ngn).toLocaleString()}</p>
                          <Badge variant={p.status === "completed" ? "default" : "secondary"} className="text-xs capitalize">{p.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={payDialogOpen} onOpenChange={open => { if (!open) { setPayDialogOpen(false); resetForm(); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="text-xl">{selectedBiller?.logo}</span>{selectedBiller?.name}
              </DialogTitle>
            </DialogHeader>
            {step === "validate" && (
              <div className="space-y-4">
                <div><Label>Account / Meter Number</Label><Input placeholder="Enter account number" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} className="mt-1" /></div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setPayDialogOpen(false); resetForm(); }}>Cancel</Button>
                  <Button onClick={() => validateMutation.mutate({ billerId: selectedBiller.id, accountNumber })} disabled={validateMutation.isPending}>{validateMutation.isPending ? "Validating..." : "Validate Account"}</Button>
                </DialogFooter>
              </div>
            )}
            {step === "confirm" && validatedAccount && (
              <div className="space-y-4">
                <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">Account Validated</p>
                  <p className="text-sm text-green-700 dark:text-green-300">{validatedAccount.accountName}</p>
                  {validatedAccount.outstandingBalance > 0 && <p className="text-xs text-green-600 dark:text-green-400">Outstanding: ₦{validatedAccount.outstandingBalance.toLocaleString()}</p>}
                </div>
                <div>
                  <Label>Amount (₦)</Label>
                  <Input type="number" placeholder="Enter amount" value={amount} onChange={e => setAmount(e.target.value)} min={selectedBiller?.minAmount} max={selectedBiller?.maxAmount} className="mt-1" />
                  <p className="text-xs text-muted-foreground mt-1">Min: ₦{selectedBiller?.minAmount?.toLocaleString()} · Max: ₦{selectedBiller?.maxAmount?.toLocaleString()}</p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setStep("validate")}>Back</Button>
                  <Button onClick={() => payMutation.mutate({ billerId: selectedBiller.id, billerName: selectedBiller.name, category: selectedBiller.category, accountNumber, amountNgn: parseFloat(amount) })} disabled={payMutation.isPending}>{payMutation.isPending ? "Processing..." : `Pay ₦${Number(amount || 0).toLocaleString()}`}</Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
