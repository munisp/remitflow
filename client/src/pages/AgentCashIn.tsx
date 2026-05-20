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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle, Store, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export default function AgentCashIn() {
  const { user } = useAuth();
  const [customerPhone, setCustomerPhone] = useState("");
  const [amountNgn, setAmountNgn] = useState(10000);
  const [customerNinLast4, setCustomerNinLast4] = useState("");
  const [pin, setPin] = useState("");
  const [lastReceipt, setLastReceipt] = useState<any>(null);

  const { data: agentProfileList } = trpc.agentNetwork.list.useQuery(undefined, { enabled: !!user });
  const agentProfile = (agentProfileList as any[])?.[0] ?? null;
  const { data: customerKyc } = trpc.immigrantWorker.getKycStatus.useQuery(undefined, { enabled: !!user && customerPhone.length > 9 });

  const processCashIn = trpc.agentNetwork.cashIn.useMutation({
    onSuccess: (d) => { toast.success("Cash-in processed successfully"); setLastReceipt(d); setCustomerPhone(""); setAmountNgn(10000); setCustomerNinLast4(""); setPin(""); },
    onError: (e) => toast.error(e.message),
  });

  const isAgent = !!(agentProfile as any)?.agentId;
  const floatBalance = parseFloat((agentProfile as any)?.floatBalance ?? "0");
  const dailyLimit = parseFloat((agentProfile as any)?.dailyCashInLimit ?? "200000");

  if (!isAgent) {
    return (
      <div className="container max-w-2xl py-16 text-center">
        <Store className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-2xl font-bold">Agent Cash-In</h1>
        <p className="text-muted-foreground mt-2 mb-6">You need to be a registered agent to process cash-in transactions.</p>
        <Link href="/agent-onboarding"><Button>Become an Agent <ArrowRight className="ml-2 h-4 w-4" /></Button></Link>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Store className="h-8 w-8 text-primary" />
        <div><h1 className="text-2xl font-bold">Agent Cash-In</h1><p className="text-muted-foreground">Process cash deposits for immigrant workers</p></div>
      </div>

      {/* Agent Float */}
      <div className="grid grid-cols-2 gap-4">
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Float Balance</p><p className="text-2xl font-bold">₦{floatBalance.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Daily Cash-In Limit</p><p className="text-2xl font-bold">₦{dailyLimit.toLocaleString()}</p></CardContent></Card>
      </div>

      {/* Receipt */}
      {lastReceipt && (
        <Alert className="border-green-500 bg-green-500/10">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <AlertDescription>
            <p className="font-medium text-green-700">Cash-in successful!</p>
            <p className="text-sm">Transaction ID: {(lastReceipt as any).transactionId}</p>
            <p className="text-sm">Amount: ₦{parseFloat((lastReceipt as any).amountNgn ?? 0).toLocaleString()}</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Cash-In Form */}
      <Card>
        <CardHeader><CardTitle>Process Cash-In</CardTitle><CardDescription>Max ₦50,000 per transaction</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); if (!customerPhone || !amountNgn || !pin) { toast.error("Fill all required fields"); return; } if (amountNgn > 50000) { toast.error("Max ₦50,000 per transaction"); return; } processCashIn.mutate({ customerId: customerPhone, amountNgn, channel: "pos" as const }); }} className="space-y-4">
            <div className="space-y-2"><Label>Customer Phone Number</Label><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+234XXXXXXXXXX" /></div>
            {customerKyc && (
              <div className="bg-muted rounded-lg p-3 flex items-center gap-2">
                <Badge className={(customerKyc as any).kycTier === "none" ? "bg-gray-400" : "bg-green-500"}>{(customerKyc as any).kycTier === "none" ? "Not Verified" : (customerKyc as any).kycTier?.toUpperCase()}</Badge>
                <span className="text-sm text-muted-foreground">Customer KYC status</span>
              </div>
            )}
            <div className="space-y-2"><Label>Amount (NGN) — Max ₦50,000</Label><Input type="number" min={100} max={50000} value={amountNgn} onChange={(e) => setAmountNgn(Number(e.target.value))} /></div>
            <div className="space-y-2"><Label>Customer NIN (last 4 digits)</Label><Input value={customerNinLast4} onChange={(e) => setCustomerNinLast4(e.target.value)} placeholder="XXXX" maxLength={4} /></div>
            <div className="space-y-2"><Label>Your Agent PIN</Label><Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4-6 digit PIN" maxLength={6} /></div>
            <Button type="submit" className="w-full" disabled={processCashIn.isPending}>{processCashIn.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Process Cash-In</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
