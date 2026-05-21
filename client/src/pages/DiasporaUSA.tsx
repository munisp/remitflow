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
import { Loader2, ArrowRight, Gift, Users, Star } from "lucide-react";
import { useTranslation } from 'react-i18next';

export default function DiasporaUSA() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [amount, setAmount] = useState(500);
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [bankName, setBankName] = useState("");
  const [memo, setMemo] = useState("");

  const { data: profile } = trpc.diasporaUSA.getDiasporaProfile.useQuery(undefined, { enabled: !!user });
  const { data: offers } = trpc.diasporaUSA.getAcquisitionOffers.useQuery(undefined, { enabled: !!user });
  const { data: rates } = trpc.diasporaUSA.getAchRates.useQuery();
  const { data: referralCode } = trpc.diasporaUSA.getReferralCode.useQuery(undefined, { enabled: !!user });
  const { data: history, refetch } = trpc.diasporaUSA.getAchTransferHistory.useQuery({ limit: 10 }, { enabled: !!user });

  const submitTransfer = trpc.diasporaUSA.submitAchTransfer.useMutation({
    onSuccess: () => { toast.success("ACH transfer submitted!"); refetch(); setRoutingNumber(""); setAccountNumber(""); setRecipientName(""); },
    onError: (e) => toast.error(e.message),
  });

  const claimOffer = trpc.diasporaUSA.claimWelcomeOffer.useMutation({
    onSuccess: () => toast.success("Offer claimed! Applied to your next transfer."),
    onError: (e) => toast.error(e.message),
  });

  const usdNgnRate = (rates as any)?.rate ?? 1538;

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      {/* Hero */}
      <div className="rounded-xl bg-gradient-to-br from-blue-900 to-blue-700 p-8 text-white">
        <div className="flex items-center gap-2 mb-2"><span className="text-3xl">🇺🇸</span><span className="text-3xl">→</span><span className="text-3xl">🇳🇬</span></div>
        <h1 className="text-3xl font-bold">Send Money to Nigeria from the USA</h1>
        <p className="text-blue-200 mt-1">Best Rates · Zero Hidden Fees · ACH Direct Debit</p>
        <div className="mt-4 flex items-center gap-4">
          <div className="bg-white/10 rounded-lg px-4 py-2"><p className="text-xs text-blue-200">Live Rate</p><p className="text-xl font-bold">$1 = ₦{usdNgnRate.toLocaleString()}</p></div>
          <Badge className="bg-green-500 text-white">No Transfer Fee — First Transfer</Badge>
        </div>
      </div>

      {/* Welcome Offers */}
      {offers && (offers as any[]).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(offers as any[]).map((offer: any) => (
            <Card key={offer.offerType} className="border-primary/30">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-2">
                  {offer.offerType === "zero_fee_first" && <Gift className="h-5 w-5 text-green-500" />}
                  {offer.offerType === "ach_cashback" && <Star className="h-5 w-5 text-yellow-500" />}
                  {offer.offerType === "referral_bonus" && <Users className="h-5 w-5 text-blue-500" />}
                  <span className="font-semibold text-sm">{offer.title ?? offer.offerType}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{offer.description ?? "Limited time offer"}</p>
                <Button size="sm" variant="outline" className="w-full" disabled={claimOffer.isPending} onClick={() => claimOffer.mutate({ offerType: offer.offerType })}>Claim Offer</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ACH Transfer Form */}
        <Card>
          <CardHeader><CardTitle>ACH Transfer</CardTitle><CardDescription>Direct debit from your US bank account</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); if (!user) { toast.error("Please log in"); return; } if (!routingNumber || !accountNumber || !recipientName) { toast.error("Fill all required fields"); return; } submitTransfer.mutate({ amountUsd: amount, recipientRoutingNumber: routingNumber, recipientAccountNumber: accountNumber, recipientName, recipientBankName: bankName, memo }); }} className="space-y-4">
              <div className="space-y-2"><Label>Amount (USD)</Label><Input type="number" min={10} max={50000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
              {amount > 0 && <div className="bg-muted rounded-lg p-3 text-sm"><div className="flex justify-between"><span>Recipient gets</span><span className="font-medium text-green-500">₦{(amount * usdNgnRate).toLocaleString()}</span></div></div>}
              <div className="space-y-2"><Label>Routing Number (9 digits)</Label><Input value={routingNumber} onChange={(e) => setRoutingNumber(e.target.value)} placeholder="021000021" maxLength={9} /></div>
              <div className="space-y-2"><Label>Account Number</Label><Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Your US account number" /></div>
              <div className="space-y-2"><Label>Account Holder Name</Label><Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Full name on account" /></div>
              <div className="space-y-2"><Label>Bank Name (optional)</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Chase, Wells Fargo" /></div>
              <div className="space-y-2"><Label>Memo (optional)</Label><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Family support" /></div>
              <Button type="submit" className="w-full" disabled={submitTransfer.isPending}>{submitTransfer.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Send via ACH <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </form>
          </CardContent>
        </Card>

        {/* Referral + History */}
        <div className="space-y-4">
          {referralCode && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm font-medium mb-1">Your Referral Code</p>
                <div className="flex items-center gap-2">
                  <code className="bg-muted px-3 py-1 rounded font-mono text-lg">{(referralCode as any).code}</code>
                  <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText((referralCode as any).code); toast.success("Copied!"); }}>Copy</Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Earn $10 for every friend who sends their first transfer</p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Transfer History</CardTitle></CardHeader>
            <CardContent>
              {!history || (history as any[]).length === 0 ? <p className="text-muted-foreground text-sm text-center py-4">No transfers yet</p> : (
                <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>{(history as any[]).map((t) => <TableRow key={t.id}><TableCell>{new Date(t.createdAt).toLocaleDateString()}</TableCell><TableCell>${parseFloat(t.amountForeign ?? 0).toLocaleString()}</TableCell><TableCell><Badge variant={t.status === "completed" ? "default" : "secondary"}>{t.status}</Badge></TableCell></TableRow>)}</TableBody></Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
