import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ArrowRight, RefreshCw, Phone } from "lucide-react";

const CORRIDOR = "TG";
const DFSP_OPTIONS = [
  { value: "tg-togocel", label: "Togocel (T-Money)" },
  { value: "tg-tmoney", label: "T-Money (Flooz)" },
];

export default function SendToTogo() {
  const { user } = useAuth();
  const [amountNgn, setAmountNgn] = useState(50000);
  const [recipientMobile, setRecipientMobile] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [dfspId, setDfspId] = useState("tg-togocel");
  const [purposeCode, setPurposeCode] = useState("FAM");

  const { data: rates, isLoading: ratesLoading } = trpc.westAfrica.getXofFxRates.useQuery();
  const { data: quote, isLoading: quoteLoading } = trpc.westAfrica.getXofQuote.useQuery(
    { corridorCode: CORRIDOR, amountNgn },
    { enabled: amountNgn >= 1000 }
  );
  const { data: history, refetch: refetchHistory } = trpc.westAfrica.getXofTransferHistory.useQuery({ limit: 10 });

  const submitMutation = trpc.westAfrica.submitXofTransfer.useMutation({
    onSuccess: (data) => {
      toast.success(`Transfer submitted! ID: ${data.transferId}`);
      refetchHistory();
      setRecipientMobile("");
      setRecipientName("");
    },
    onError: (err) => toast.error(err.message),
  });

  const togoRate = (rates as any)?.TG;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { toast.error("Please log in to send money"); return; }
    if (!recipientMobile || !recipientName) { toast.error("Please fill all required fields"); return; }
    submitMutation.mutate({
      corridorCode: CORRIDOR,
      amountNgn,
      recipientMobileMoney: recipientMobile,
      recipientName,
      mojaloopDfspId: dfspId,
      purposeCode,
    });
  };

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-4xl">🇹🇬</span>
        <div>
          <h1 className="text-2xl font-bold">Send Money to Togo</h1>
          <p className="text-muted-foreground">Fast mobile money transfers via Mojaloop — T-Money & Togocel</p>
        </div>
        <Badge variant="secondary" className="ml-auto">XOF Corridor</Badge>
      </div>

      {/* Live Rate Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Live Exchange Rate</CardTitle>
        </CardHeader>
        <CardContent>
          {ratesLoading ? (
            <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading rates...</div>
          ) : togoRate ? (
            <div className="flex items-center gap-6">
              <div>
                <div className="text-2xl font-bold">₦1 = {togoRate.xof_per_ngn?.toFixed(4)} XOF</div>
                <div className="text-sm text-muted-foreground">Spread: {togoRate.spread_bps} bps</div>
              </div>
              <Badge variant="outline" className="text-green-500 border-green-500">Live</Badge>
            </div>
          ) : (
            <Alert><AlertDescription>Rate unavailable — using fallback</AlertDescription></Alert>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Transfer Form */}
        <Card>
          <CardHeader>
            <CardTitle>Send Transfer</CardTitle>
            <CardDescription>Funds arrive via mobile money in minutes</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Amount (NGN)</Label>
                <Input
                  type="number"
                  min={1000}
                  max={10000000}
                  value={amountNgn}
                  onChange={(e) => setAmountNgn(Number(e.target.value))}
                  placeholder="50000"
                />
              </div>

              {quote && (
                <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span>You send</span><span className="font-medium">₦{amountNgn.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Recipient gets</span><span className="font-medium text-green-500">{(quote as any).amount_xof?.toLocaleString()} XOF</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>Fee</span><span>₦{(quote as any).fee_ngn?.toLocaleString() ?? "—"}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>ETA</span><span>{(quote as any).estimated_minutes ?? "5–10"} min</span></div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Mobile Network</Label>
                <Select value={dfspId} onValueChange={setDfspId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DFSP_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Recipient Mobile Number</Label>
                <div className="flex gap-2 items-center">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={recipientMobile}
                    onChange={(e) => setRecipientMobile(e.target.value)}
                    placeholder="+228XXXXXXXX"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Recipient Name</Label>
                <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Full name" />
              </div>

              <div className="space-y-2">
                <Label>Purpose</Label>
                <Select value={purposeCode} onValueChange={setPurposeCode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FAM">Family Support</SelectItem>
                    <SelectItem value="EDU">Education</SelectItem>
                    <SelectItem value="MED">Medical</SelectItem>
                    <SelectItem value="BUS">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" className="w-full" disabled={submitMutation.isPending || quoteLoading}>
                {submitMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : <>Send to Togo <ArrowRight className="ml-2 h-4 w-4" /></>}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Transfer History */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Transfers</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => refetchHistory()}><RefreshCw className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent>
            {!history || (history as any[]).length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">No transfers yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(history as any[]).map((t) => (
                    <TableRow key={t.transferId}>
                      <TableCell className="font-medium">{t.recipientName}</TableCell>
                      <TableCell>₦{parseFloat(t.amountNgn).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={t.status === "completed" ? "default" : t.status === "failed" ? "destructive" : "secondary"}>
                          {t.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
