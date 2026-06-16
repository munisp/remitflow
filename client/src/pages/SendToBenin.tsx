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
import { Loader2, ArrowRight, Phone } from "lucide-react";
import { useTranslation } from 'react-i18next';

const CORRIDOR = "BJ";
const DFSP_OPTIONS = [
  { value: "bj-mtn", label: "MTN MoMo Benin" },
  { value: "bj-moov", label: "Moov Money Benin" },
];

export default function SendToBenin() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [amountNgn, setAmountNgn] = useState(50000);
  const [recipientMobile, setRecipientMobile] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [dfspId, setDfspId] = useState("bj-mtn");
  const [purposeCode, setPurposeCode] = useState("FAM");

  const { data: rates } = trpc.westAfrica.getXofFxRates.useQuery();
  const { data: quote } = trpc.westAfrica.getXofQuote.useQuery({ corridorCode: CORRIDOR, amountNgn }, { enabled: amountNgn >= 1000 });
  const { data: history, refetch } = trpc.westAfrica.getXofTransferHistory.useQuery({ limit: 10 });

  const submit = trpc.westAfrica.submitXofTransfer.useMutation({
    onSuccess: (d) => { toast.success(`Transfer submitted! ID: ${(d as any).transferId}`); refetch(); setRecipientMobile(""); setRecipientName(""); },
    onError: (e) => toast.error(e.message),
  });

  const beninRate = (rates as any)?.BJ;

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-4xl">🇧🇯</span>
        <div><h1 className="text-2xl font-bold">Send Money to Benin</h1><p className="text-muted-foreground">MTN MoMo & Moov Money via Mojaloop</p></div>
        <Badge variant="secondary" className="ml-auto">XOF Corridor</Badge>
      </div>
      {beninRate && (
        <Card><CardContent className="pt-4 flex items-center gap-6">
          <div><div className="text-2xl font-bold">₦1 = {beninRate.xof_per_ngn?.toFixed(4)} XOF</div><div className="text-sm text-muted-foreground">Spread: {beninRate.spread_bps} bps</div></div>
          <Badge variant="outline" className="text-green-500 border-green-500">Live</Badge>
        </CardContent></Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Send Transfer</CardTitle><CardDescription>Funds arrive via mobile money in minutes</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); if (!user || !recipientMobile || !recipientName) { toast.error("Fill all fields"); return; } submit.mutate({ corridorCode: CORRIDOR, amountNgn, recipientMobileMoney: recipientMobile, recipientName, mojaloopDfspId: dfspId, purposeCode }); }} className="space-y-4">
              <div className="space-y-2"><Label>Amount (NGN)</Label><Input type="number" min={1000} value={amountNgn} onChange={(e) => setAmountNgn(Number(e.target.value))} /></div>
              {quote && <div className="bg-muted rounded-lg p-3 text-sm space-y-1"><div className="flex justify-between"><span>Recipient gets</span><span className="font-medium text-green-500">{(quote as any).amount_xof?.toLocaleString()} XOF</span></div></div>}
              <div className="space-y-2"><Label>Mobile Network</Label><Select value={dfspId} onValueChange={setDfspId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DFSP_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Recipient Mobile</Label><div className="flex gap-2 items-center"><Phone className="h-4 w-4 text-muted-foreground" /><Input value={recipientMobile} onChange={(e) => setRecipientMobile(e.target.value)} placeholder="+229XXXXXXXX" /></div></div>
              <div className="space-y-2"><Label>Recipient Name</Label><Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Full name" /></div>
              <div className="space-y-2"><Label>Purpose</Label><Select value={purposeCode} onValueChange={setPurposeCode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FAM">Family Support</SelectItem><SelectItem value="EDU">Education</SelectItem><SelectItem value="MED">Medical</SelectItem><SelectItem value="BUS">Business</SelectItem></SelectContent></Select></div>
              <Button type="submit" className="w-full" disabled={submit.isPending}>{submit.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : <>Send to Benin <ArrowRight className="ml-2 h-4 w-4" /></>}</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent Transfers</CardTitle></CardHeader>
          <CardContent>
            {!history || (history as any[]).length === 0 ? <p className="text-muted-foreground text-sm text-center py-8">No transfers yet</p> : (
              <Table><TableHeader><TableRow><TableHead>Recipient</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{(history as any[]).map((t) => <TableRow key={t.transferId}><TableCell>{t.recipientName}</TableCell><TableCell>₦{parseFloat(t.amountNgn).toLocaleString()}</TableCell><TableCell><Badge variant={t.status === "completed" ? "default" : "secondary"}>{t.status}</Badge></TableCell></TableRow>)}</TableBody></Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
