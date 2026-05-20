import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, Send, RefreshCw, CheckCircle, Clock, XCircle, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["GBP","EUR","USD","CAD","AUD","SGD","HKD","CHF","SEK","NOK","DKK","PLN","CZK","HUF","RON","NGN","GHS","KES","ZAR"];

export default function WiseTransfer() {
  const { t } = useTranslation();
  const { data: txData, refetch } = trpc.mojaloop.transfers.useQuery({ limit: 20 });
  const sendWise = trpc.mojaloop.transfer.useMutation({
    onSuccess: (d) => { refetch(); setAmount(""); setAccount(""); toast.success(`Transfer initiated! Ref: ${(d as any).reference ?? "N/A"}`); },
    onError: (e: any) => toast.error(e.message),
  });
  const { data: ratesData } = trpc.fx.rates.useQuery();

  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("GBP");
  const [to, setTo] = useState("NGN");
  const [account, setAccount] = useState("");
  const [recipientName, setRecipientName] = useState("");

  const rates: Record<string, number> = (ratesData as any)?.rates ?? {};
  const rate = rates[to] && rates[from] ? rates[to] / rates[from] : 0;
  const fee = parseFloat(amount || "0") * 0.005;
  const youSend = parseFloat(amount || "0");
  const recipientGets = rate ? ((youSend - fee) * rate).toFixed(2) : "—";
  const transfers = Array.isArray(txData) ? txData : (txData as any)?.transfers ?? [];

  const statusIcon = (s: string) => s === "completed" ? <CheckCircle className="w-4 h-4 text-green-500" /> : s === "failed" ? <XCircle className="w-4 h-4 text-red-500" /> : <Clock className="w-4 h-4 text-yellow-500" />;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Zap className="w-7 h-7 text-blue-600" /> Wise-Style Transfer</h1>
          <p className="text-muted-foreground">Low-fee international transfers with mid-market rates</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Send Form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Send className="w-5 h-5" /> New Transfer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>You send</Label>
                  <div className="flex gap-2">
                    <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="flex-1" />
                    <Select value={from} onValueChange={setFrom}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Recipient gets</Label>
                  <div className="flex gap-2">
                    <Input value={recipientGets} readOnly className="flex-1 bg-muted" />
                    <Select value={to} onValueChange={setTo}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Fee Breakdown */}
              {amount && (
                <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Exchange rate</span><span>1 {from} = {rate ? rate.toFixed(4) : "—"} {to}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Transfer fee (0.5%)</span><span>{fee.toFixed(2)} {from}</span></div>
                  <div className="flex justify-between font-medium border-t pt-1 mt-1"><span>You send total</span><span>{youSend.toFixed(2)} {from}</span></div>
                </div>
              )}

              <div>
                <Label>Recipient Name *</Label>
                <Input placeholder="Full name" value={recipientName} onChange={e => setRecipientName(e.target.value)} />
              </div>
              <div>
                <Label>Account Number / IBAN *</Label>
                <Input placeholder="GB29 NWBK 6016 1331 9268 19" value={account} onChange={e => setAccount(e.target.value)} />
              </div>

              <Button className="w-full" disabled={!amount || !account || !recipientName || sendWise.isPending}
                onClick={() => sendWise.mutate({ amount: parseFloat(amount), currency: to, payeeFsp: 'remitflow', payeeId: account, note: `Wise transfer to ${recipientName}` })}>
                {sendWise.isPending ? "Processing..." : `Send ${amount || "0"} ${from}`}
              </Button>
              <p className="text-xs text-muted-foreground text-center">Transfers typically arrive within 1-2 business days</p>
            </CardContent>
          </Card>

          {/* Transfer History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><RefreshCw className="w-5 h-5" /> Transfer History</CardTitle>
            </CardHeader>
            <CardContent>
              {transfers.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No transfers yet</p>
              ) : (
                <div className="space-y-3">
                  {transfers.slice(0, 10).map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-2">
                        {statusIcon(t.status)}
                        <div>
                          <p className="text-sm font-medium">{t.recipientName ?? t.reference ?? `TXN-${t.id}`}</p>
                          <p className="text-xs text-muted-foreground">{t.createdAt ? format(new Date(t.createdAt), "MMM d, yyyy") : ""}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{t.fromCurrency} {Number(t.fromAmount ?? t.amount).toLocaleString()}</p>
                        <Badge className={`text-xs ${t.status === "completed" ? "bg-green-100 text-green-800" : t.status === "failed" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}`}>{t.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
