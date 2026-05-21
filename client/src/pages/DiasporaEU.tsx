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
import { Loader2, ArrowRight } from "lucide-react";
import { useTranslation } from 'react-i18next';

const EU_COUNTRIES = [
  { value: "IT", label: "🇮🇹 Italy", currency: "EUR" },
  { value: "DE", label: "🇩🇪 Germany", currency: "EUR" },
  { value: "FR", label: "🇫🇷 France", currency: "EUR" },
  { value: "ES", label: "🇪🇸 Spain", currency: "EUR" },
  { value: "NL", label: "🇳🇱 Netherlands", currency: "EUR" },
  { value: "BE", label: "🇧🇪 Belgium", currency: "EUR" },
  { value: "PT", label: "🇵🇹 Portugal", currency: "EUR" },
];

export default function DiasporaEU() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [destinationCountry, setDestinationCountry] = useState("IT" as "CA" | "DE" | "FR" | "NL" | "IT" | "ES" | "BE" | "PT");
  const [amount, setAmount] = useState(500);
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [reference, setReference] = useState("");

  const { data: rates } = trpc.diasporaEU.getSepaRates.useQuery({ destinationCountry });
  const { data: offers } = trpc.diasporaEU.getAcquisitionOffers.useQuery(undefined, { enabled: !!user });
  const { data: history, refetch } = trpc.diasporaEU.getSepaTransferHistory.useQuery({ limit: 10 }, { enabled: !!user });

  const submitTransfer = trpc.diasporaEU.submitSepaTransfer.useMutation({
    onSuccess: () => { toast.success("SEPA transfer submitted!"); refetch(); setIban(""); setRecipientName(""); },
    onError: (e) => toast.error(e.message),
  });

  const claimOffer = trpc.diasporaEU.claimWelcomeOffer.useMutation({
    onSuccess: () => toast.success("Offer claimed!"),
    onError: (e) => toast.error(e.message),
  });

  const eurNgnRate = (rates as any)?.rate ?? 1680;
  const settlementTime = (rates as any)?.settlementTime ?? "1-2 hours";
  const selectedCountry = EU_COUNTRIES.find(c => c.value === destinationCountry);

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="rounded-xl bg-gradient-to-br from-blue-800 to-yellow-600 p-8 text-white">
        <div className="flex items-center gap-2 mb-2"><span className="text-3xl">🇪🇺</span><span className="text-3xl">→</span><span className="text-3xl">🇳🇬</span></div>
        <h1 className="text-3xl font-bold">Send Money to Nigeria from Europe</h1>
        <p className="text-white/80 mt-1">SEPA Instant Transfers · Best EUR/NGN Rates · 7 Countries</p>
      </div>

      {/* Country Selector with Rates */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {EU_COUNTRIES.map(c => (
          <button key={c.value} onClick={() => setDestinationCountry(c.value as "CA" | "DE" | "FR" | "NL" | "IT" | "ES" | "BE" | "PT")} className={`rounded-lg border p-3 text-left transition-all ${destinationCountry === c.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
            <div className="font-medium text-sm">{c.label}</div>
            <div className="text-xs text-muted-foreground">{c.currency}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4 flex items-center gap-6">
          <div><div className="text-2xl font-bold">€1 = ₦{eurNgnRate.toLocaleString()}</div><div className="text-sm text-muted-foreground">Settlement: {settlementTime}</div></div>
          <Badge variant="outline" className="text-green-500 border-green-500">SEPA Instant</Badge>
        </CardContent>
      </Card>

      {offers && (offers as any[]).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(offers as any[]).slice(0, 3).map((offer: any) => (
            <Card key={offer.offerType}><CardContent className="pt-4"><p className="font-semibold text-sm mb-1">{offer.title ?? offer.offerType}</p><p className="text-xs text-muted-foreground mb-3">{offer.description ?? "Limited time offer"}</p><Button size="sm" variant="outline" className="w-full" onClick={() => claimOffer.mutate({ offerType: offer.offerType })}>Claim</Button></CardContent></Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>SEPA Transfer from {selectedCountry?.label}</CardTitle><CardDescription>Funds arrive in Nigeria within {settlementTime}</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); if (!user || !iban || !recipientName) { toast.error("Fill all required fields"); return; } submitTransfer.mutate({ amountEur: amount, recipientIban: iban, recipientBic: bic, recipientName, reference, destinationCountry: destinationCountry as any }); }} className="space-y-4">
              <div className="space-y-2"><Label>Amount (EUR)</Label><Input type="number" min={10} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
              {amount > 0 && <div className="bg-muted rounded-lg p-3 text-sm"><div className="flex justify-between"><span>Recipient gets</span><span className="font-medium text-green-500">₦{(amount * eurNgnRate).toLocaleString()}</span></div></div>}
              <div className="space-y-2"><Label>IBAN</Label><Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IT60X0542811101000000123456" /></div>
              <div className="space-y-2"><Label>BIC/SWIFT (optional)</Label><Input value={bic} onChange={(e) => setBic(e.target.value)} placeholder="BPPIITRRXXX" /></div>
              <div className="space-y-2"><Label>Recipient Name</Label><Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Full name" /></div>
              <div className="space-y-2"><Label>Reference (optional)</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Family support" /></div>
              <Button type="submit" className="w-full" disabled={submitTransfer.isPending}>{submitTransfer.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Send via SEPA <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Transfer History</CardTitle></CardHeader>
          <CardContent>
            {!history || (history as any[]).length === 0 ? <p className="text-muted-foreground text-sm text-center py-4">No transfers yet</p> : (
              <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Country</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{(history as any[]).map((t) => <TableRow key={t.id}><TableCell>{new Date(t.createdAt).toLocaleDateString()}</TableCell><TableCell>€{parseFloat(t.amountForeign ?? 0).toLocaleString()}</TableCell><TableCell>{t.corridorCode}</TableCell><TableCell><Badge variant={t.status === "completed" ? "default" : "secondary"}>{t.status}</Badge></TableCell></TableRow>)}</TableBody></Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
