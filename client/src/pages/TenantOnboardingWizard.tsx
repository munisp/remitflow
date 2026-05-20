import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, Circle, Loader2, Building2, CreditCard,
  Shield, Key, Rocket, ChevronRight, ChevronLeft, AlertCircle
} from "lucide-react";

interface WizardData {
  companyName: string; companyType: string; country: string;
  registrationNumber: string; contactEmail: string; contactPhone: string;
  billingTier: "starter" | "growth" | "enterprise";
  platformSplitPct: number; transferFeePct: number; fxSpreadPct: number;
  onboardingFeeUsd: number; monthlyPlatformFeeUsd: number;
  complianceLevel: string; corridors: string[]; amlProvider: string; kycTier: string;
  webhookUrl: string; ipWhitelist: string; rateLimitPerMin: number;
}

const TEMPORAL_STEPS = [
  "Validate company registration",
  "Create billing tenant record",
  "Provision Permify roles & policies",
  "Create Kafka topics for tenant",
  "Initialise TigerBeetle ledger accounts",
  "Configure corridor pricing",
  "Set up AML/KYC screening rules",
  "Generate API credentials",
  "Register Mojaloop DFSP participant",
  "Send welcome email to admin",
  "Mark tenant as active",
];

type StepStatus = "pending" | "running" | "complete" | "failed";

function StepIndicator({ step, current, label, icon: Icon }: {
  step: number; current: number; label: string; icon: React.ElementType;
}) {
  const done = step < current;
  const active = step === current;
  return (
    <div className={`flex items-center gap-2 text-sm ${active ? "text-primary font-semibold" : done ? "text-green-500" : "text-muted-foreground"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${active ? "border-primary bg-primary text-primary-foreground" : done ? "border-green-500 bg-green-500 text-white" : "border-muted"}`}>
        {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
      </div>
      <span className="hidden sm:block">{label}</span>
    </div>
  );
}

function WorkflowProgress({ steps, statuses }: { steps: string[]; statuses: StepStatus[] }) {
  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const status = statuses[i] ?? "pending";
        return (
          <div key={i} className="flex items-center gap-3 text-sm">
            {status === "complete" && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
            {status === "running" && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
            {status === "pending" && <Circle className="w-4 h-4 text-muted-foreground shrink-0" />}
            {status === "failed" && <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
            <span className={status === "complete" ? "text-foreground" : status === "running" ? "text-primary font-medium" : "text-muted-foreground"}>
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function TenantOnboardingWizard() {
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState(1);
  const [workflowStatuses, setWorkflowStatuses] = useState<StepStatus[]>(TEMPORAL_STEPS.map(() => "pending"));
  const [provisionedTenantId, setProvisionedTenantId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);

  const [data, setData] = useState<WizardData>({
    companyName: "", companyType: "imto_partner", country: "NG",
    registrationNumber: "", contactEmail: "", contactPhone: "",
    billingTier: "growth", platformSplitPct: 40, transferFeePct: 1.2,
    fxSpreadPct: 0.5, onboardingFeeUsd: 500, monthlyPlatformFeeUsd: 200,
    complianceLevel: "standard", corridors: ["UK_NG", "US_NG"],
    amlProvider: "smile_id", kycTier: "tier2",
    webhookUrl: "", ipWhitelist: "", rateLimitPerMin: 100,
  });

  const provisionMutation = trpc.billingEngine.provisionTenant.useMutation({
    onSuccess: (result) => {
      setProvisionedTenantId(result.tenantId);
      setWorkflowId(result.workflowId ?? null);
      simulateWorkflow();
    },
    onError: (err) => toast.error(`Provisioning failed: ${err.message}`),
  });

  const simulateWorkflow = () => {
    TEMPORAL_STEPS.forEach((_, i) => {
      setTimeout(() => {
        setWorkflowStatuses((prev) => {
          const next = [...prev];
          if (i > 0) next[i - 1] = "complete";
          next[i] = "running";
          return next;
        });
        if (i === TEMPORAL_STEPS.length - 1) {
          setTimeout(() => {
            setWorkflowStatuses(TEMPORAL_STEPS.map(() => "complete"));
            toast.success("Tenant provisioned successfully!");
          }, 800);
        }
      }, i * 700);
    });
  };

  const update = (field: keyof WizardData, value: unknown) =>
    setData((prev) => ({ ...prev, [field]: value }));

  const canProceed = () => {
    if (currentStep === 1) return !!(data.companyName && data.contactEmail && data.registrationNumber);
    if (currentStep === 2) return !!(data.billingTier && data.platformSplitPct > 0);
    if (currentStep === 3) return !!(data.complianceLevel && data.corridors.length > 0);
    return true;
  };

  const handleLaunch = () => {
    setCurrentStep(5);
    provisionMutation.mutate({
      companyName: data.companyName,
      companyType: data.companyType,
      country: data.country,
      registrationNumber: data.registrationNumber,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone || undefined,
      billingTier: data.billingTier,
      platformSplitPct: data.platformSplitPct,
      transferFeePct: data.transferFeePct,
      fxSpreadPct: data.fxSpreadPct,
      onboardingFeeUsd: data.onboardingFeeUsd,
      monthlyPlatformFeeUsd: data.monthlyPlatformFeeUsd,
      complianceLevel: data.complianceLevel,
      corridors: data.corridors,
      amlProvider: data.amlProvider,
      kycTier: data.kycTier,
      webhookUrl: data.webhookUrl || undefined,
      ipWhitelist: data.ipWhitelist || undefined,
      rateLimitPerMin: data.rateLimitPerMin,
    });
  };

  const completedSteps = workflowStatuses.filter((s) => s === "complete").length;
  const progressPct = Math.round((completedSteps / TEMPORAL_STEPS.length) * 100);
  const allDone = workflowStatuses.every((s) => s === "complete");

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">New Tenant Onboarding</h1>
        <p className="text-muted-foreground mt-1">Provision a new IMTO partner or white-label customer on the RemitFlow platform.</p>
      </div>

      <div className="flex items-center justify-between mb-8 overflow-x-auto gap-2">
        <StepIndicator step={1} current={currentStep} label="Company" icon={Building2} />
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        <StepIndicator step={2} current={currentStep} label="Billing" icon={CreditCard} />
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        <StepIndicator step={3} current={currentStep} label="Compliance" icon={Shield} />
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        <StepIndicator step={4} current={currentStep} label="API Keys" icon={Key} />
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        <StepIndicator step={5} current={currentStep} label="Launch" icon={Rocket} />
      </div>

      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" /> Company Information</CardTitle>
            <CardDescription>Basic details about the partner organisation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Company Name *</Label>
                <Input value={data.companyName} onChange={(e) => update("companyName", e.target.value)} placeholder="Acme Remittance Ltd" />
              </div>
              <div className="space-y-2">
                <Label>Company Type</Label>
                <Select value={data.companyType} onValueChange={(v) => update("companyType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="imto_partner">IMTO Partner</SelectItem>
                    <SelectItem value="white_label">White-Label Customer</SelectItem>
                    <SelectItem value="aggregator">Payment Aggregator</SelectItem>
                    <SelectItem value="bank">Commercial Bank</SelectItem>
                    <SelectItem value="mfi">Microfinance Institution</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Registration Number *</Label>
                <Input value={data.registrationNumber} onChange={(e) => update("registrationNumber", e.target.value)} placeholder="RC-1234567" />
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Select value={data.country} onValueChange={(v) => update("country", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NG">Nigeria</SelectItem>
                    <SelectItem value="GB">United Kingdom</SelectItem>
                    <SelectItem value="US">United States</SelectItem>
                    <SelectItem value="CA">Canada</SelectItem>
                    <SelectItem value="AE">UAE</SelectItem>
                    <SelectItem value="GH">Ghana</SelectItem>
                    <SelectItem value="KE">Kenya</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Contact Email *</Label>
                <Input type="email" value={data.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} placeholder="admin@acme.com" />
              </div>
              <div className="space-y-2">
                <Label>Contact Phone</Label>
                <Input value={data.contactPhone} onChange={(e) => update("contactPhone", e.target.value)} placeholder="+234 800 000 0000" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5" /> Billing Configuration</CardTitle>
            <CardDescription>Set fee rates, profit sharing, and platform charges</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Billing Tier</Label>
                <Select value={data.billingTier} onValueChange={(v) => update("billingTier", v as WizardData["billingTier"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter (up to $100K/mo)</SelectItem>
                    <SelectItem value="growth">Growth (up to $1M/mo)</SelectItem>
                    <SelectItem value="enterprise">Enterprise (unlimited)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Platform Split % (platform keeps)</Label>
                <Input type="number" min={10} max={90} value={data.platformSplitPct} onChange={(e) => update("platformSplitPct", Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Transfer Fee %</Label>
                <Input type="number" step={0.1} min={0} max={5} value={data.transferFeePct} onChange={(e) => update("transferFeePct", Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>FX Spread %</Label>
                <Input type="number" step={0.1} min={0} max={3} value={data.fxSpreadPct} onChange={(e) => update("fxSpreadPct", Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Onboarding Fee (USD)</Label>
                <Input type="number" min={0} value={data.onboardingFeeUsd} onChange={(e) => update("onboardingFeeUsd", Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Monthly Platform Fee (USD)</Label>
                <Input type="number" min={0} value={data.monthlyPlatformFeeUsd} onChange={(e) => update("monthlyPlatformFeeUsd", Number(e.target.value))} />
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 text-sm">
              <p className="font-medium mb-1">Revenue Preview (per $500 transfer)</p>
              <p className="text-muted-foreground">Platform fee share: <strong>${((500 * data.transferFeePct / 100) * data.platformSplitPct / 100).toFixed(2)}</strong></p>
              <p className="text-muted-foreground">Partner share: <strong>${((500 * data.transferFeePct / 100) * (100 - data.platformSplitPct) / 100).toFixed(2)}</strong></p>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5" /> Compliance Settings</CardTitle>
            <CardDescription>Configure AML/KYC requirements and active corridors</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Compliance Level</Label>
                <Select value={data.complianceLevel} onValueChange={(v) => update("complianceLevel", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic (KYC Tier 1)</SelectItem>
                    <SelectItem value="standard">Standard (KYC Tier 2 + AML)</SelectItem>
                    <SelectItem value="enhanced">Enhanced (Full EDD + FATF)</SelectItem>
                    <SelectItem value="cbdc">CBDC-Ready (CBN compliant)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>AML Provider</Label>
                <Select value={data.amlProvider} onValueChange={(v) => update("amlProvider", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smile_id">Smile ID</SelectItem>
                    <SelectItem value="jumio">Jumio</SelectItem>
                    <SelectItem value="onfido">Onfido</SelectItem>
                    <SelectItem value="internal">Internal (RemitFlow)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>KYC Tier Required</Label>
                <Select value={data.kycTier} onValueChange={(v) => update("kycTier", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tier1">Tier 1 (₦50K/day)</SelectItem>
                    <SelectItem value="tier2">Tier 2 (₦200K/day)</SelectItem>
                    <SelectItem value="tier3">Tier 3 (₦5M/day)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Active Corridors (click to toggle)</Label>
              <div className="grid grid-cols-3 gap-2">
                {["UK_NG", "US_NG", "CA_NG", "UAE_NG", "EU_NG", "SA_NG", "GH_NG", "KE_NG"].map((corridor) => {
                  const active = data.corridors.includes(corridor);
                  return (
                    <button key={corridor} type="button"
                      onClick={() => update("corridors", active ? data.corridors.filter((c) => c !== corridor) : [...data.corridors, corridor])}
                      className={`px-3 py-2 rounded-md text-sm border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"}`}>
                      {corridor.replace("_", " → ")}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Key className="w-5 h-5" /> API & Integration Settings</CardTitle>
            <CardDescription>Configure webhook endpoints and access controls</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Webhook URL (optional)</Label>
              <Input value={data.webhookUrl} onChange={(e) => update("webhookUrl", e.target.value)} placeholder="https://partner.example.com/webhooks/remitflow" />
            </div>
            <div className="space-y-2">
              <Label>IP Whitelist (optional, comma-separated)</Label>
              <Input value={data.ipWhitelist} onChange={(e) => update("ipWhitelist", e.target.value)} placeholder="192.168.1.1, 10.0.0.0/24" />
            </div>
            <div className="space-y-2">
              <Label>API Rate Limit (requests/min)</Label>
              <Input type="number" min={10} max={10000} value={data.rateLimitPerMin} onChange={(e) => update("rateLimitPerMin", Number(e.target.value))} />
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">API credentials will be generated automatically</p>
              <p className="text-amber-700 dark:text-amber-300">Your API key and secret will be sent to {data.contactEmail || "the contact email"}. Store them securely.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 5 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="w-5 h-5" />
              {allDone ? "Tenant Provisioned!" : "Provisioning Tenant..."}
            </CardTitle>
            <CardDescription>
              {allDone ? `${data.companyName} is now live on the RemitFlow platform.` : "Running the 11-step Temporal onboarding workflow."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!allDone && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{progressPct}%</span>
                </div>
                <Progress value={progressPct} />
              </div>
            )}
            <WorkflowProgress steps={TEMPORAL_STEPS} statuses={workflowStatuses} />
            {allDone && provisionedTenantId && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Tenant ID</span>
                    <Badge variant="outline" className="font-mono">{provisionedTenantId}</Badge>
                  </div>
                  {workflowId && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Workflow ID</span>
                      <Badge variant="outline" className="font-mono text-xs">{workflowId}</Badge>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Company</span>
                    <span className="text-sm font-medium">{data.companyName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Billing Tier</span>
                    <Badge className="capitalize">{data.billingTier}</Badge>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button onClick={() => navigate("/admin/billing-engine")} className="flex-1">View Billing Dashboard</Button>
                  <Button variant="outline" onClick={() => navigate("/admin/tenants")} className="flex-1">All Tenants</Button>
                </div>
              </>
            )}
            {provisionMutation.isError && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-sm text-destructive">
                <p className="font-medium">Provisioning failed</p>
                <p>{provisionMutation.error?.message}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setCurrentStep(4)}>Go Back & Retry</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {currentStep < 5 && (
        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={() => currentStep > 1 ? setCurrentStep(currentStep - 1) : navigate("/admin/tenants")}>
            <ChevronLeft className="w-4 h-4 mr-1" />
            {currentStep === 1 ? "Cancel" : "Back"}
          </Button>
          {currentStep < 4 ? (
            <Button onClick={() => setCurrentStep(currentStep + 1)} disabled={!canProceed()}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleLaunch} disabled={provisionMutation.isPending}>
              {provisionMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
              Launch Tenant
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
