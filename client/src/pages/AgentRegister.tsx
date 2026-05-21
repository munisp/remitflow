/**
 * AgentRegister.tsx — Agent Onboarding Flow
 * Multi-step form: Business Info → Location → Documents → Review
 * Creates agent_accounts record and triggers KYB review workflow
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle, Building2, MapPin, FileText, ClipboardCheck, ChevronRight, ChevronLeft, Loader2, Shield, Banknote, TrendingUp } from "lucide-react";
import { useTranslation } from 'react-i18next';

type Step = "business" | "location" | "documents" | "review" | "success";

const STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: "business", label: "Business Info", icon: <Building2 className="h-4 w-4" /> },
  { id: "location", label: "Location", icon: <MapPin className="h-4 w-4" /> },
  { id: "documents", label: "Documents", icon: <FileText className="h-4 w-4" /> },
  { id: "review", label: "Review", icon: <ClipboardCheck className="h-4 w-4" /> },
];

const TIER_INFO = {
  basic: { label: "Basic", dailyLimit: "₦1,000,000", commission: "1.5%", color: "bg-slate-100 text-slate-700" },
  silver: { label: "Silver", dailyLimit: "₦2,000,000", commission: "1.6%", color: "bg-slate-200 text-slate-800" },
  gold: { label: "Gold", dailyLimit: "₦5,000,000", commission: "1.8%", color: "bg-yellow-100 text-yellow-800" },
  platinum: { label: "Platinum", dailyLimit: "₦10,000,000", commission: "2.0%", color: "bg-purple-100 text-purple-800" },
};

export default function AgentRegister() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const [step, setStep] = useState<Step>("business");
  const [form, setForm] = useState({
    businessName: "",
    businessType: "individual" as "individual" | "partnership" | "limited" | "cooperative",
    tier: "basic" as "basic" | "gold" | "silver" | "platinum",
    phone: user?.phone ?? "",
    email: user?.email ?? "",
    // Location
    address: "",
    city: "",
    state: "",
    country: "NG",
    // Documents
    cacNumber: "",
    tinNumber: "",
    bankName: "",
    bankAccountNumber: "",
    bankAccountName: "",
    // Notes
    notes: "",
  });

  const registerMutation = trpc.agentOnboarding.register.useMutation({
    onSuccess: () => {
      setStep("success");
      utils.posAgentCashFlow.agentStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const update = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const stepIndex = STEPS.findIndex(s => s.id === step);
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  if (step === "success") {
    return (
      <DashboardLayout>
        <div className="max-w-lg mx-auto p-8 text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle className="h-10 w-10 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Application Submitted!</h1>
            <p className="text-muted-foreground mt-2">
              Your agent application for <strong>{form.businessName}</strong> has been submitted for KYB review.
              You will receive an email within 24–48 hours.
            </p>
          </div>
          <div className="bg-muted rounded-xl p-4 text-left space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Tier Applied</span><Badge className={TIER_INFO[form.tier as keyof typeof TIER_INFO].color}>{TIER_INFO[form.tier as keyof typeof TIER_INFO].label}</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Daily Limit</span><span className="font-medium">{TIER_INFO[form.tier as keyof typeof TIER_INFO].dailyLimit}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Commission Rate</span><span className="font-medium">{TIER_INFO[form.tier as keyof typeof TIER_INFO].commission}</span></div>
          </div>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate("/agent/pos")}>Go to POS</Button>
            <Button onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Become a RemitFlow Agent</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Earn commissions processing cash-in and cash-out transactions for customers in your community.
          </p>
        </div>

        {/* Benefits strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: <Banknote className="h-5 w-5 text-green-600" />, label: "Earn Commission", sub: "Up to 2% per transaction" },
            { icon: <Shield className="h-5 w-5 text-blue-600" />, label: "Insured Float", sub: "NDIC-backed protection" },
            { icon: <TrendingUp className="h-5 w-5 text-purple-600" />, label: "Tier Upgrades", sub: "Auto-upgrade on volume" },
          ].map(b => (
            <div key={b.label} className="bg-muted/50 rounded-xl p-3 text-center">
              <div className="flex justify-center mb-1">{b.icon}</div>
              <div className="text-xs font-semibold">{b.label}</div>
              <div className="text-xs text-muted-foreground">{b.sub}</div>
            </div>
          ))}
        </div>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            {STEPS.map((s, i) => (
              <div key={s.id} className={`flex items-center gap-1 ${i <= stepIndex ? "text-primary font-medium" : ""}`}>
                {s.icon}{s.label}
              </div>
            ))}
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Step: Business Info */}
        {step === "business" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />Business Information</CardTitle>
              <CardDescription>Tell us about your business</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Business Name *</Label>
                <Input placeholder="e.g. Adaeze Money Transfer" value={form.businessName} onChange={e => update("businessName", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Business Type</Label>
                <Select value={form.businessType} onValueChange={v => update("businessType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual / Sole Trader</SelectItem>
                    <SelectItem value="partnership">Partnership</SelectItem>
                    <SelectItem value="limited">Limited Company</SelectItem>
                    <SelectItem value="cooperative">Cooperative</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Phone Number *</Label>
                <Input placeholder="+234 801 234 5678" value={form.phone} onChange={e => update("phone", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input type="email" placeholder="business@example.com" value={form.email} onChange={e => update("email", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Agent Tier *</Label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(TIER_INFO).map(([key, info]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => update("tier", key)}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${form.tier === key ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm">{info.label}</span>
                        {form.tier === key && <CheckCircle className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="text-xs text-muted-foreground">Limit: {info.dailyLimit}/day</div>
                      <div className="text-xs text-muted-foreground">Commission: {info.commission}</div>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step: Location */}
        {step === "location" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" />Business Location</CardTitle>
              <CardDescription>Where will you operate from?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Street Address *</Label>
                <Input placeholder="15 Victoria Island" value={form.address} onChange={e => update("address", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>City *</Label>
                  <Input placeholder="Lagos" value={form.city} onChange={e => update("city", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>State *</Label>
                  <Input placeholder="Lagos State" value={form.state} onChange={e => update("state", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Select value={form.country} onValueChange={v => update("country", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NG">Nigeria</SelectItem>
                    <SelectItem value="GH">Ghana</SelectItem>
                    <SelectItem value="KE">Kenya</SelectItem>
                    <SelectItem value="SN">Senegal</SelectItem>
                    <SelectItem value="CI">Côte d'Ivoire</SelectItem>
                    <SelectItem value="TZ">Tanzania</SelectItem>
                    <SelectItem value="UG">Uganda</SelectItem>
                    <SelectItem value="ZA">South Africa</SelectItem>
                    <SelectItem value="ET">Ethiopia</SelectItem>
                    <SelectItem value="RW">Rwanda</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step: Documents */}
        {step === "documents" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Business Documents</CardTitle>
              <CardDescription>Required for KYB verification</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>CAC Registration Number</Label>
                <Input placeholder="RC-1234567" value={form.cacNumber} onChange={e => update("cacNumber", e.target.value)} />
                <p className="text-xs text-muted-foreground">Corporate Affairs Commission number (Nigeria). Leave blank for other countries.</p>
              </div>
              <div className="space-y-2">
                <Label>Tax Identification Number (TIN)</Label>
                <Input placeholder="12345678-0001" value={form.tinNumber} onChange={e => update("tinNumber", e.target.value)} />
              </div>
              <div className="border-t pt-4 space-y-3">
                <Label className="text-base font-semibold">Settlement Bank Account</Label>
                <p className="text-xs text-muted-foreground">Commissions will be paid to this account</p>
                <div className="space-y-2">
                  <Label>Bank Name *</Label>
                  <Select value={form.bankName} onValueChange={v => update("bankName", v)}>
                    <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                    <SelectContent>
                      {["GTBank", "Access Bank", "Zenith Bank", "UBA", "First Bank", "Fidelity Bank", "Sterling Bank", "Wema Bank", "Stanbic IBTC", "Polaris Bank", "GCB Bank", "Ecobank", "KCB Bank", "Equity Bank"].map(b => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Account Number *</Label>
                  <Input placeholder="0123456789" value={form.bankAccountNumber} onChange={e => update("bankAccountNumber", e.target.value)} maxLength={10} />
                </div>
                <div className="space-y-2">
                  <Label>Account Name *</Label>
                  <Input placeholder="ADAEZE OKAFOR" value={form.bankAccountName} onChange={e => update("bankAccountName", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Additional Notes</Label>
                <Textarea placeholder="Any additional information about your business..." value={form.notes} onChange={e => update("notes", e.target.value)} rows={3} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step: Review */}
        {step === "review" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Review Your Application</CardTitle>
              <CardDescription>Please confirm all details before submitting</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "Business Name", value: form.businessName },
                { label: "Business Type", value: form.businessType },
                { label: "Phone", value: form.phone },
                { label: "Email", value: form.email },
                { label: "Tier", value: TIER_INFO[form.tier as keyof typeof TIER_INFO].label },
                { label: "Address", value: `${form.address}, ${form.city}, ${form.state}, ${form.country}` },
                { label: "CAC Number", value: form.cacNumber || "—" },
                { label: "TIN", value: form.tinNumber || "—" },
                { label: "Bank", value: form.bankName ? `${form.bankName} — ${form.bankAccountNumber}` : "—" },
              ].map(row => (
                <div key={row.label} className="flex justify-between text-sm border-b pb-2 last:border-0">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium text-right max-w-[60%]">{row.value}</span>
                </div>
              ))}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                By submitting, you agree to RemitFlow's Agent Terms of Service and confirm all information is accurate.
                KYB review takes 24–48 hours.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
              const prev = STEPS[stepIndex - 1];
              if (prev) setStep(prev.id);
            }}
            disabled={stepIndex === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />Back
          </Button>

          {step !== "review" ? (
            <Button
              onClick={() => {
                // Basic validation per step
                if (step === "business" && !form.businessName.trim()) {
                  toast.error("Please enter your business name");
                  return;
                }
                if (step === "location" && (!form.address.trim() || !form.city.trim())) {
                  toast.error("Please enter your address and city");
                  return;
                }
                if (step === "documents" && (!form.bankName || !form.bankAccountNumber.trim())) {
                  toast.error("Please enter your settlement bank account details");
                  return;
                }
                const next = STEPS[stepIndex + 1];
                if (next) setStep(next.id);
              }}
            >
              Next<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={() => registerMutation.mutate({
                businessName: form.businessName,
                businessType: form.businessType,
                tier: form.tier,
                phone: form.phone,
                email: form.email,
                location: `${form.address}, ${form.city}, ${form.state}`,
                country: form.country,
                cacNumber: form.cacNumber || undefined,
                tinNumber: form.tinNumber || undefined,
                bankName: form.bankName || undefined,
                bankAccountNumber: form.bankAccountNumber || undefined,
                bankAccountName: form.bankAccountName || undefined,
                notes: form.notes || undefined,
              })}
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting...</> : "Submit Application"}
            </Button>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
