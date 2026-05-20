import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ArrowRight } from "lucide-react";

const DESTINATION = "CA";

export default function DiasporaCanada() {
  const { user } = useAuth();
  const [amount, setAmount] = useState(500);
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [reference, setReference] = useState("");

  const { data: rates } = trpc.diasporaEU.getCanadaEftRates.useQuery();
  const { data: offers } = trpc.diasporaEU.getAcquisitionOffers.useQuery(undefined, { enabled: !!user });
  const { data: history, refetch } = trpc.diasporaEU.getSepaTransferHistory.useQuery({ limit: 10 }, { enabled: !!user });

  const submitTransfer = trpc.diasporaEU.submitSepaTransfer.useMutation({
    onSuccess: () => { toast.success("EFT transfer submitted!"); refetch(); setIban(""); setRecipientName(""); },
    onError: (e) => toast.error(e.message),
  });

  const claimOffer = trpc.diasporaEU.claimWelcomeOffer.useMutation({
    onSuccess: () => toast.success("Offer claimed!"),
    onError: (e) => toast.error(e.message),
  });

  const cadNgnRate = (rates as any)?.rate ?? 1120;

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="rounded-xl bg-gradient-to-br from-red-900 to-red-700 p-8 text-white">
        <div className="flex items-center gap-2 mb-2"><span className="text-3xl">🇨🇦</span><span className="text-3xl">→</span><span className="text-3xl">🇳🇬</span></div>
        <h1 className="text-3xl font-bold">Send Money to Nigeria from Canada</h1>
        <p className="text-red-200 mt-1">Fast EFT Transfers · Best CAD/NGN Rates · No Hidden Fees</p>
        <div className="mt-4"><div className="bg-white/10 rounded-lg px-4 py-2 inline-block"><p className="text-xs text-red-200">Live Rate</p><p className="text-xl font-bold">CA$1 = ₦{cadNgnRate.toLocaleString()}</p></div></div>
      </div>

      {offers && (offers as any[]).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(offers as any[]).slice(0, 3).map((offer: any) => (
            <Card key={offer.offerType}><CardContent className="pt-4"><p className="font-semibold text-sm mb-1">{offer.title ?? offer.offerType}</p><p className="text-xs text-muted-foreground mb-3">{offer.description ?? "Limited time offer"}</p><Button size="sm" variant="outline" className="w-full" onClick={() => claimOffer.mutate({ offerType: offer.offerType })}>Claim</Button></CardContent></Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>EFT Transfer</CardTitle><CardDescription>Direct from your Canadian bank account</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); if (!user || !iban || !recipientName) { toast.error("Fill all required fields"); return; } submitTransfer.mutate({ amountEur: amount, recipientIban: iban, recipientBic: bic, recipientName, reference, destinationCountry: DESTINATION }); }} className="space-y-4">
              <div className="space-y-2"><Label>Amount (CAD)</Label><Input type="number" min={10} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
              {amount > 0 && <div className="bg-muted rounded-lg p-3 text-sm"><div className="flex justify-between"><span>Recipient gets</span><span className="font-medium text-green-500">₦{(amount * cadNgnRate).toLocaleString()}</span></div></div>}
              <div className="space-y-2"><Label>Account / IBAN</Label><Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="Your Canadian account number" /></div>
              <div className="space-y-2"><Label>Transit/Institution Number (optional)</Label><Input value={bic} onChange={(e) => setBic(e.target.value)} placeholder="e.g. 00102-004" /></div>
              <div className="space-y-2"><Label>Account Holder Name</Label><Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Full name" /></div>
              <div className="space-y-2"><Label>Reference (optional)</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Family support" /></div>
              <Button type="submit" className="w-full" disabled={submitTransfer.isPending}>{submitTransfer.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Send via EFT <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Transfer History</CardTitle></CardHeader>
          <CardContent>
            {!history || (history as any[]).length === 0 ? <p className="text-muted-foreground text-sm text-center py-4">No transfers yet</p> : (
              <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{(history as any[]).map((t) => <TableRow key={t.id}><TableCell>{new Date(t.createdAt).toLocaleDateString()}</TableCell><TableCell>CA${parseFloat(t.amountForeign ?? 0).toLocaleString()}</TableCell><TableCell><Badge variant={t.status === "completed" ? "default" : "secondary"}>{t.status}</Badge></TableCell></TableRow>)}</TableBody></Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
