import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowDownLeft, Copy, QrCode, Building2, Share2, Clock, CheckCircle, XCircle, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const SUPPORTED_CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR"];

export default function ReceiveMoney() {
  const { t } = useTranslation();
  const { data: profile } = trpc.auth.me.useQuery();
  const { data: wallets = [] } = trpc.wallet.list.useQuery();
  const { data: virtualAccounts = [] } = trpc.virtualAccount.list.useQuery();
  const { data: recentReceived = [] } = trpc.transactions.list.useQuery({ type: "receive", limit: 10 });

  // Payment request state
  const [requestAmount, setRequestAmount] = useState("");
  const [requestCurrency, setRequestCurrency] = useState("USD");
  const [requestNote, setRequestNote] = useState("");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  const utils = trpc.useUtils();

  // Fetch persisted payment requests from backend
  const { data: paymentRequests = [], isLoading: requestsLoading } = trpc.requestMoney.list.useQuery({ limit: 20 });

  const createRequest = trpc.requestMoney.create.useMutation({
    onSuccess: (data) => {
      setGeneratedLink(data.paymentLink);
      utils.requestMoney.list.invalidate();
      toast.success("Payment link created and saved!");
    },
    onError: (err) => toast.error(err.message),
  });

  const walletArr = Array.isArray(wallets) ? wallets : [];
  const vaArr = Array.isArray(virtualAccounts) ? virtualAccounts : [];
  const txArr = Array.isArray(recentReceived) ? recentReceived : [];
  const reqArr = Array.isArray(paymentRequests) ? paymentRequests : [];

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied!`);
  };

  const handleGenerateLink = () => {
    createRequest.mutate({
      amount: requestAmount ? Number(requestAmount) : undefined,
      currency: requestCurrency,
      description: requestNote || undefined,
    });
  };

  const statusIcon = (status: string) => {
    if (status === "paid") return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (status === "expired") return <XCircle className="w-4 h-4 text-red-400" />;
    return <Clock className="w-4 h-4 text-amber-400" />;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowDownLeft className="w-6 h-6 text-green-500" />Receive Money
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Multiple ways to receive payments from anywhere in the world</p>
        </div>

        <Tabs defaultValue="link">
          <TabsList className="grid grid-cols-3 w-full max-w-md">
            <TabsTrigger value="link">Payment Link</TabsTrigger>
            <TabsTrigger value="bank">Bank Transfer</TabsTrigger>
            <TabsTrigger value="qr">QR Code</TabsTrigger>
          </TabsList>

          {/* ─── Payment Link Tab ─────────────────────────────────────────────── */}
          <TabsContent value="link" className="mt-4 max-w-lg space-y-4">
            <Card>
              <CardHeader><CardTitle>Request Payment</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Amount (optional)</Label>
                    <Input className="mt-1" type="number" value={requestAmount} onChange={e => setRequestAmount(e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select value={requestCurrency} onValueChange={setRequestCurrency}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Note / Description (optional)</Label>
                  <Input className="mt-1" value={requestNote} onChange={e => setRequestNote(e.target.value)} placeholder="e.g. Invoice #1234 or Rent payment" />
                </div>
                <Button className="w-full" onClick={handleGenerateLink} disabled={createRequest.isPending}>
                  {createRequest.isPending ? "Creating..." : "Generate Payment Link"}
                </Button>
                {generatedLink && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                    <p className="text-xs text-green-400 font-medium mb-2 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Link saved — expires in 72 hours</p>
                    <div className="flex gap-2">
                      <Input readOnly value={generatedLink} className="text-xs font-mono flex-1" />
                      <Button variant="outline" size="icon" onClick={() => copy(generatedLink, "Payment link")}><Copy className="w-4 h-4" /></Button>
                      <Button variant="outline" size="icon" onClick={() => {
                        if (navigator.share) navigator.share({ title: "Pay me via RemitFlow", url: generatedLink });
                        else copy(generatedLink, "Payment link");
                      }}><Share2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ─── Saved Payment Requests ─────────────────────────────────────── */}
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Link2 className="w-4 h-4" />My Payment Requests</CardTitle></CardHeader>
              <CardContent>
                {requestsLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
                ) : reqArr.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No payment requests yet. Generate one above.</p>
                ) : (
                  <div className="space-y-2">
                    {reqArr.map((req: any) => (
                      <div key={req.id} className="flex items-center justify-between py-2 border-b last:border-0 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {statusIcon(req.status)}
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {req.amount ? `${req.currency} ${Number(req.amount).toLocaleString()}` : `${req.currency} (any amount)`}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{req.note ?? "No note"} · {new Date(req.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge variant="outline" className={`text-xs ${req.status === "paid" ? "text-green-400" : req.status === "expired" ? "text-red-400" : "text-amber-400"}`}>
                            {req.status}
                          </Badge>
                          {req.status === "pending" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(`${window.location.origin}/pay/${req.token}`, "Payment link")}>
                              <Copy className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Bank Transfer Tab ────────────────────────────────────────────── */}
          <TabsContent value="bank" className="mt-4">
            {vaArr.length === 0 ? (
              <Card className="text-center py-10">
                <CardContent>
                  <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="font-medium">No virtual accounts yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Create a virtual account to receive bank transfers</p>
                  <Button className="mt-4" onClick={() => window.location.href = "/virtual-account"}>Create Virtual Account</Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {vaArr.map((va: any) => (
                  <Card key={va.id}>
                    <CardHeader className="pb-2"><CardTitle className="text-base">{va.currency} Bank Details</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {[
                        { label: "Account Number", value: va.accountNumber ?? "0123456789" },
                        { label: "Bank Name", value: va.bankName ?? "RemitFlow Virtual Bank" },
                        { label: "Sort Code", value: va.sortCode ?? "20-00-00" },
                        { label: "Reference", value: `RF${(profile as any)?.id ?? "000"}` },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-center justify-between py-1.5 border-b last:border-0">
                          <span className="text-muted-foreground">{label}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium">{value}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copy(value, label)}><Copy className="w-3 h-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ─── QR Code Tab ──────────────────────────────────────────────────── */}
          <TabsContent value="qr" className="mt-4 max-w-sm">
            <Card>
              <CardContent className="flex flex-col items-center gap-4 pt-6">
                <div className="p-4 bg-white rounded-xl border-2 border-primary/20">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(JSON.stringify({ userId: (profile as any)?.id, name: profile?.name }))}`}
                    alt="QR Code"
                    className="w-40 h-40"
                  />
                </div>
                <p className="font-semibold">{profile?.name ?? "RemitFlow User"}</p>
                <p className="text-sm text-muted-foreground text-center">Scan this QR code to send money directly to my RemitFlow account</p>
                <Button variant="outline" className="w-full" onClick={() => copy(`${window.location.origin}/pay/${(profile as any)?.id}`, "Profile link")}>
                  <Copy className="w-4 h-4 mr-2" />Copy Profile Link
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ─── Recent Received Payments ─────────────────────────────────────── */}
        {txArr.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Recent Received Payments</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {txArr.slice(0, 8).map((tx: any) => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <ArrowDownLeft className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{tx.description ?? "Received payment"}</p>
                      <p className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-green-600">+{tx.toCurrency ?? tx.fromCurrency} {Number(tx.toAmount ?? tx.fromAmount).toLocaleString()}</p>
                    <Badge variant="outline" className="text-xs">{tx.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
