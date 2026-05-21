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
import { Loader2, ArrowRight, Zap } from "lucide-react";
import { useTranslation } from 'react-i18next';

const DESTINATION = "IT";

export default function DiasporaItaly() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [amount, setAmount] = useState(500);
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [reference, setReference] = useState("");

  const { data: rates } = trpc.diasporaEU.getSepaRates.useQuery({ destinationCountry: "IT" as any });
  const { data: offers } = trpc.diasporaEU.getAcquisitionOffers.useQuery(undefined, { enabled: !!user });
  const { data: history, refetch } = trpc.diasporaEU.getSepaTransferHistory.useQuery({ limit: 10 }, { enabled: !!user });

  const submitTransfer = trpc.diasporaEU.submitSepaTransfer.useMutation({
    onSuccess: () => { toast.success("SEPA transfer submitted!"); refetch(); setIban(""); setRecipientName(""); },
    onError: (e) => toast.error(e.message),
  });

  const claimOffer = trpc.diasporaEU.claimWelcomeOffer.useMutation({
    onSuccess: () => toast.success("Offerta richiesta! Applicata al prossimo trasferimento."),
    onError: (e) => toast.error(e.message),
  });

  const eurNgnRate = (rates as any)?.rate ?? 1680;

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="rounded-xl bg-gradient-to-br from-green-800 to-red-700 p-8 text-white">
        <div className="flex items-center gap-2 mb-2"><span className="text-3xl">🇮🇹</span><span className="text-3xl">→</span><span className="text-3xl">🇳🇬</span></div>
        <h1 className="text-3xl font-bold">Invia Denaro in Nigeria dall'Italia</h1>
        <p className="text-white/80 mt-1">Tassi Imbattibili · SEPA Instant · Nessuna Commissione Nascosta</p>
        <div className="mt-4 flex items-center gap-4">
          <div className="bg-white/10 rounded-lg px-4 py-2"><p className="text-xs text-white/70">Tasso Live</p><p className="text-xl font-bold">€1 = ₦{eurNgnRate.toLocaleString()}</p></div>
          <Badge className="bg-green-500 text-white flex items-center gap-1"><Zap className="h-3 w-3" />SEPA Instant</Badge>
        </div>
      </div>

      {offers && (offers as any[]).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(offers as any[]).slice(0, 3).map((offer: any) => (
            <Card key={offer.offerType}><CardContent className="pt-4"><p className="font-semibold text-sm mb-1">{offer.title ?? offer.offerType}</p><p className="text-xs text-muted-foreground mb-3">{offer.description ?? "Offerta a tempo limitato"}</p><Button size="sm" variant="outline" className="w-full" onClick={() => claimOffer.mutate({ offerType: offer.offerType as any })}>Richiedi</Button></CardContent></Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Trasferimento SEPA</CardTitle><CardDescription>Addebito diretto dal tuo conto italiano</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); if (!user || !iban || !recipientName) { toast.error("Compila tutti i campi"); return; } submitTransfer.mutate({ amountEur: amount, recipientIban: iban, recipientBic: bic, recipientName, reference, destinationCountry: "IT" as any }); }} className="space-y-4">
              <div className="space-y-2"><Label>Importo (EUR)</Label><Input type="number" min={10} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
              {amount > 0 && <div className="bg-muted rounded-lg p-3 text-sm"><div className="flex justify-between"><span>Il destinatario riceve</span><span className="font-medium text-green-500">₦{(amount * eurNgnRate).toLocaleString()}</span></div></div>}
              <div className="space-y-2"><Label>IBAN</Label><Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IT60X0542811101000000123456" /></div>
              <div className="space-y-2"><Label>BIC/SWIFT (opzionale)</Label><Input value={bic} onChange={(e) => setBic(e.target.value)} placeholder="BPPIITRRXXX" /></div>
              <div className="space-y-2"><Label>Nome del beneficiario</Label><Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Nome completo" /></div>
              <div className="space-y-2"><Label>Riferimento (opzionale)</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="es. Supporto familiare" /></div>
              <Button type="submit" className="w-full" disabled={submitTransfer.isPending}>{submitTransfer.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Invia via SEPA <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Cronologia Trasferimenti</CardTitle></CardHeader>
          <CardContent>
            {!history || (history as any[]).length === 0 ? <p className="text-muted-foreground text-sm text-center py-4">Nessun trasferimento ancora</p> : (
              <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Importo</TableHead><TableHead>Stato</TableHead></TableRow></TableHeader>
              <TableBody>{(history as any[]).map((t) => <TableRow key={t.id}><TableCell>{new Date(t.createdAt).toLocaleDateString("it-IT")}</TableCell><TableCell>€{parseFloat(t.amountForeign ?? 0).toLocaleString()}</TableCell><TableCell><Badge variant={t.status === "completed" ? "default" : "secondary"}>{t.status}</Badge></TableCell></TableRow>)}</TableBody></Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
