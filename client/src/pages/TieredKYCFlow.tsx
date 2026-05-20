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
import { Loader2, CheckCircle, ShieldCheck, Upload } from "lucide-react";

const TIERS = [
  { tier: "tier1", label: "Tier 1 — Basic", limit: "$500/month", color: "bg-yellow-500", description: "NIN + Selfie + Phone" },
  { tier: "tier2", label: "Tier 2 — Enhanced", limit: "$2,000/month", color: "bg-blue-500", description: "Government ID + Utility Bill + BVN" },
  { tier: "tier3", label: "Tier 3 — Full", limit: "$10,000/month", color: "bg-green-500", description: "Full KYC review by compliance team" },
];

export default function TieredKYCFlow() {
  const { user } = useAuth();
  const [activeStep, setActiveStep] = useState(1);
  const [nin, setNin] = useState("");
  const [selfieUrl, setSelfieUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [employer, setEmployer] = useState("");
  const [workState, setWorkState] = useState("");
  const [docType, setDocType] = useState("national_id");
  const [docUrl, setDocUrl] = useState("");
  const [utilityUrl, setUtilityUrl] = useState("");
  const [bvn, setBvn] = useState("");

  const { data: kycStatus, refetch } = trpc.immigrantWorker.getKycStatus.useQuery(undefined, { enabled: !!user });

  const submitTier1 = trpc.immigrantWorker.submitSimplifiedKyc.useMutation({
    onSuccess: () => { toast.success("Tier 1 KYC submitted for review"); refetch(); setActiveStep(2); },
    onError: (e) => toast.error(e.message),
  });

  const upgradeTier = trpc.immigrantWorker.upgradeKycTier.useMutation({
    onSuccess: () => { toast.success("Tier 2 KYC submitted for review"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const currentTier = (kycStatus as any)?.kycTier ?? "none";
  const currentTierIndex = TIERS.findIndex(t => t.tier === currentTier);
  const progressPct = currentTier === "none" ? 0 : currentTier === "tier1" ? 33 : currentTier === "tier2" ? 66 : 100;

  return (
    <div className="container max-w-2xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-8 w-8 text-primary" />
        <div><h1 className="text-2xl font-bold">KYC Verification</h1><p className="text-muted-foreground">Verify your identity to unlock higher transfer limits</p></div>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex justify-between text-sm"><span>Current Status</span><Badge className={currentTier === "none" ? "bg-gray-400" : TIERS.find(t => t.tier === currentTier)?.color ?? "bg-gray-400"}>{currentTier === "none" ? "Not Verified" : currentTier.toUpperCase()}</Badge></div>
          <Progress value={progressPct} className="h-3" />
          <div className="grid grid-cols-3 gap-2">
            {TIERS.map((t, i) => (
              <div key={t.tier} className={`rounded-lg border p-3 text-center ${currentTierIndex >= i ? "border-primary bg-primary/5" : "border-border opacity-50"}`}>
                {currentTierIndex >= i && <CheckCircle className="h-4 w-4 text-green-500 mx-auto mb-1" />}
                <p className="text-xs font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.limit}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tier 1 Form */}
      {(currentTier === "none" || activeStep === 1) && currentTier !== "tier2" && currentTier !== "tier3" && (
        <Card>
          <CardHeader><CardTitle>Step 1 — Basic Verification (Tier 1)</CardTitle><CardDescription>NIN + Selfie + Employment details · Unlocks $500/month</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); if (!nin || nin.length !== 11) { toast.error("NIN must be 11 digits"); return; } if (!selfieUrl || !phone) { toast.error("Fill all required fields"); return; } submitTier1.mutate({ nin, selfieUrl, phoneNumber: phone, employerName: employer, workState }); }} className="space-y-4">
              <div className="space-y-2"><Label>NIN (11 digits)</Label><Input value={nin} onChange={(e) => setNin(e.target.value)} placeholder="12345678901" maxLength={11} /></div>
              <div className="space-y-2"><Label>Selfie URL</Label><div className="flex gap-2"><Input value={selfieUrl} onChange={(e) => setSelfieUrl(e.target.value)} placeholder="https://..." /><Button type="button" variant="outline" size="sm"><Upload className="h-4 w-4" /></Button></div></div>
              <div className="space-y-2"><Label>Phone Number</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234XXXXXXXXXX" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Employer Name (optional)</Label><Input value={employer} onChange={(e) => setEmployer(e.target.value)} placeholder="Company name" /></div>
                <div className="space-y-2"><Label>Work State (optional)</Label><Input value={workState} onChange={(e) => setWorkState(e.target.value)} placeholder="e.g. Lagos" /></div>
              </div>
              <Button type="submit" className="w-full" disabled={submitTier1.isPending}>{submitTier1.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Submit Tier 1 KYC</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Tier 2 Form */}
      {(currentTier === "tier1" || activeStep === 2) && currentTier !== "tier3" && (
        <Card>
          <CardHeader><CardTitle>Step 2 — Enhanced Verification (Tier 2)</CardTitle><CardDescription>Government ID + Utility Bill + BVN · Unlocks $2,000/month</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); if (!docUrl || !bvn) { toast.error("Fill all required fields"); return; } upgradeTier.mutate({ documentType: docType as any, documentUrl: docUrl, utilityBillUrl: utilityUrl, bvn }); }} className="space-y-4">
              <div className="space-y-2"><Label>Document Type</Label><Select value={docType} onValueChange={setDocType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="national_id">National ID</SelectItem><SelectItem value="drivers_license">Driver's License</SelectItem><SelectItem value="passport">International Passport</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Document Image URL</Label><div className="flex gap-2"><Input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://..." /><Button type="button" variant="outline" size="sm"><Upload className="h-4 w-4" /></Button></div></div>
              <div className="space-y-2"><Label>Utility Bill URL (optional)</Label><div className="flex gap-2"><Input value={utilityUrl} onChange={(e) => setUtilityUrl(e.target.value)} placeholder="https://..." /><Button type="button" variant="outline" size="sm"><Upload className="h-4 w-4" /></Button></div></div>
              <div className="space-y-2"><Label>BVN (11 digits)</Label><Input value={bvn} onChange={(e) => setBvn(e.target.value)} placeholder="12345678901" maxLength={11} /></div>
              <Button type="submit" className="w-full" disabled={upgradeTier.isPending}>{upgradeTier.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Submit Tier 2 KYC</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {currentTier === "tier3" && (
        <Card><CardContent className="pt-6 text-center"><CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-3" /><h2 className="text-xl font-bold">Fully Verified</h2><p className="text-muted-foreground mt-1">You have the highest KYC tier with a $10,000/month limit.</p></CardContent></Card>
      )}
    </div>
  );
}
