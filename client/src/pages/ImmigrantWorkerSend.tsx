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
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ArrowRight, ShieldCheck, AlertTriangle } from "lucide-react";
import { Link } from "wouter";

const CORRIDORS = [
  { value: "TG", label: "Togo" },
  { value: "NE", label: "Niger" },
  { value: "ML", label: "Mali" },
  { value: "BJ", label: "Benin" },
  { value: "GH", label: "Ghana" },
];

export default function ImmigrantWorkerSend() {
  const { user } = useAuth();
  const [amountNgn, setAmountNgn] = useState(20000);
  const [recipientMobile, setRecipientMobile] = useState("");
  const [corridorCode, setCorridorCode] = useState("TG");
  const [recipientName, setRecipientName] = useState("");

  const { data: kycStatus } = trpc.immigrantWorker.getKycStatus.useQuery(undefined, { enabled: !!user });
  const { data: limitData } = trpc.immigrantWorker.getMonthlyLimit.useQuery(undefined, { enabled: !!user });

  const submitKyc = trpc.immigrantWorker.submitSimplifiedKyc.useMutation({
    onSuccess: () => toast.success("KYC submitted for review"),
    onError: (e) => toast.error(e.message),
  });

  const submitTransfer = trpc.immigrantWorker.submitWorkerTransfer.useMutation({
    onSuccess: (d) => toast.success(`Transfer submitted! ID: ${(d as any).transferId}`),
    onError: (e) => toast.error(e.message),
  });

  const kycTier = (kycStatus as any)?.kycTier ?? "none";
  const monthlyUsed = parseFloat((limitData as any)?.monthlyUsedUsd ?? "0");
  const monthlyLimit = parseFloat((limitData as any)?.monthlyLimitUsd ?? "500");
  const usedPct = Math.min((monthlyUsed / monthlyLimit) * 100, 100);
  const remaining = Math.max(monthlyLimit - monthlyUsed, 0);

  const tierColor = kycTier === "tier3" ? "bg-green-500" : kycTier === "tier2" ? "bg-blue-500" : kycTier === "tier1" ? "bg-yellow-500" : "bg-gray-400";

  return (
    <div className="container max-w-2xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-8 w-8 text-primary" />
        <div><h1 className="text-2xl font-bold">Worker Remittance</h1><p className="text-muted-foreground">Simplified transfers for immigrant workers in Nigeria</p></div>
      </div>

      {/* KYC Status */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">KYC Status</span>
            <Badge className={tierColor}>{kycTier === "none" ? "Not Verified" : kycTier.toUpperCase()}</Badge>
          </div>
          {kycTier !== "none" && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-sm"><span>Monthly Limit Used</span><span>${monthlyUsed.toFixed(0)} / ${monthlyLimit.toFixed(0)}</span></div>
                <Progress value={usedPct} className="h-2" />
                <p className="text-xs text-muted-foreground">Remaining: ${remaining.toFixed(0)} this month</p>
              </div>
              {remaining < 50 && <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>You are near your monthly limit. <Link href="/tiered-kyc">Upgrade KYC</Link> for higher limits.</AlertDescription></Alert>}
            </>
          )}
          {kycTier === "none" && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Complete basic KYC to start sending money home.</p>
              <Link href="/tiered-kyc"><Button variant="outline" className="w-full">Complete KYC Verification</Button></Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transfer Form */}
      {kycTier !== "none" && (
        <Card>
          <CardHeader><CardTitle>Send Money Home</CardTitle><CardDescription>Fast mobile money transfers to West Africa</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); if (!user || !recipientMobile || !recipientName) { toast.error("Fill all fields"); return; } submitTransfer.mutate({ amountNgn, recipientMobileMoney: recipientMobile, corridorCode: corridorCode as any, recipientName, mojaloopDfspId: "REMITFLOW" }); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Destination Country</Label>
                <Select value={corridorCode} onValueChange={setCorridorCode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CORRIDORS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-2"><Label>Amount (NGN) — Max ₦{kycTier === "tier1" ? "100,000" : kycTier === "tier2" ? "500,000" : "2,000,000"}</Label><Input type="number" min={500} max={kycTier === "tier1" ? 100000 : kycTier === "tier2" ? 500000 : 2000000} value={amountNgn} onChange={(e) => setAmountNgn(Number(e.target.value))} /></div>
              <div className="space-y-2"><Label>Recipient Mobile Number</Label><Input value={recipientMobile} onChange={(e) => setRecipientMobile(e.target.value)} placeholder="+228XXXXXXXX" /></div>
              <div className="space-y-2"><Label>Recipient Name</Label><Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Full name" /></div>
              <Button type="submit" className="w-full" disabled={submitTransfer.isPending}>{submitTransfer.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : <>Send Money <ArrowRight className="ml-2 h-4 w-4" /></>}</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
