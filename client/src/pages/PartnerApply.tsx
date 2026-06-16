import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {  Building2, User, Globe, Shield, Palette, CheckCircle2,
  ArrowRight, ArrowLeft, Rocket, FileText, DollarSign, Users
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const STEPS = [
  { id: 1, title: "Company Info", icon: Building2, description: "Tell us about your business" },
  { id: 2, title: "Contact Details", icon: User, description: "Who should we reach?" },
  { id: 3, title: "Business Details", icon: Globe, description: "Operations & corridors" },
  { id: 4, title: "Compliance", icon: Shield, description: "Regulatory & AML status" },
  { id: 5, title: "Branding", icon: Palette, description: "Your brand identity" },
  { id: 6, title: "Review & Submit", icon: Rocket, description: "Final review" },
];

const PLAN_FEATURES: Record<string, string[]> = {
  starter: ["Up to 500 users", "5 corridors", "Basic analytics", "Email support"],
  growth: ["Up to 5,000 users", "20 corridors", "Advanced analytics", "Priority support", "Custom domain"],
  enterprise: ["Unlimited users", "Unlimited corridors", "Full analytics suite", "Dedicated account manager", "SLA guarantee"],
  white_label: ["Everything in Enterprise", "Full white-label branding", "Custom mobile app", "API access", "Revenue sharing"],
};

export default function PartnerApply() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [trackingSlug, setTrackingSlug] = useState("");

  const [form, setForm] = useState({
    companyName: "",
    brandName: "",
    applicationType: "fintech_startup" as const,
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    website: "",
    country: "NG",
    registrationNumber: "",
    taxId: "",
    incorporationDate: "",
    businessDescription: "",
    expectedMonthlyVolume: "",
    expectedUserCount: "",
    targetCorridors: [] as string[],
    requestedPlan: "starter" as "starter" | "growth" | "enterprise" | "white_label",
    hasAmlPolicy: false,
    hasKycProcess: false,
    isRegulated: false,
    regulatoryLicenses: [] as string[],
    primaryColor: "#7c3aed",
    secondaryColor: "#06b6d4",
  });

  const submitMutation = trpc.partnerApplications.submit.useMutation({
    onSuccess: (data) => {
      setTrackingSlug(data.slug);
      setSubmitted(true);
      toast.success("Application submitted successfully!");
    },
    onError: (err) => toast.error(err.message),
  });

  const update = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const toggleCorridor = (corridor: string) => {
    setForm(prev => ({
      ...prev,
      targetCorridors: prev.targetCorridors.includes(corridor)
        ? prev.targetCorridors.filter(c => c !== corridor)
        : [...prev.targetCorridors, corridor],
    }));
  };

  const handleSubmit = () => {
    submitMutation.mutate({
      ...form,
      expectedMonthlyVolume: form.expectedMonthlyVolume ? Number(form.expectedMonthlyVolume) : undefined,
      expectedUserCount: form.expectedUserCount ? Number(form.expectedUserCount) : undefined,
    });
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full bg-white/10 border-white/20 text-white text-center">
          <CardContent className="pt-8 pb-8">
            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Application Submitted!</h2>
            <p className="text-white/70 mb-6">
              Your partner application has been received. Our team will review it within 2–3 business days.
            </p>
            <div className="bg-white/10 rounded-lg p-4 mb-6 text-left">
              <p className="text-xs text-white/50 mb-1">Tracking Reference</p>
              <p className="font-mono text-sm font-bold text-violet-300">{trackingSlug}</p>
            </div>
            <div className="space-y-3">
              <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={() => navigate(`/partner/application/${trackingSlug}`)}>
                Track Application Status
              </Button>
              <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10" onClick={() => navigate("/")}>
                Return to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  return (

    <DashboardLayout>
    <div className="min-h-screen bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-900 p-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8 pt-8">
          <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 mb-4">White-Label Partner Program</Badge>
          <h1 className="text-3xl font-bold text-white mb-2">Apply to Become a Partner</h1>
          <p className="text-white/60">Launch your own remittance platform powered by RemitFlow</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-between mb-6 overflow-x-auto pb-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div className={`flex flex-col items-center min-w-[60px] ${step >= s.id ? "opacity-100" : "opacity-40"}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mb-1 ${step > s.id ? "bg-green-500 text-white" : step === s.id ? "bg-violet-500 text-white" : "bg-white/10 text-white/50"}`}>
                  {step > s.id ? <CheckCircle2 className="w-4 h-4" /> : s.id}
                </div>
                <span className="text-[10px] text-white/60 text-center hidden sm:block">{s.title}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 mx-2 ${step > s.id ? "bg-green-500" : "bg-white/10"}`} style={{ minWidth: 20 }} />
              )}
            </div>
          ))}
        </div>

        <Progress value={progress} className="mb-6 h-1 bg-white/10" />

        {/* Step Content */}
        <Card className="bg-white/10 border-white/20 text-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {(() => { const S = STEPS[step - 1]; const Icon = S.icon; return <Icon className="w-5 h-5 text-violet-400" />; })()}
              {STEPS[step - 1].title}
            </CardTitle>
            <CardDescription className="text-white/60">{STEPS[step - 1].description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Step 1: Company Info */}
            {step === 1 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/80">Legal Company Name *</Label>
                    <Input className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1" placeholder="Acme Fintech Ltd" value={form.companyName} onChange={e => update("companyName", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-white/80">Brand Name *</Label>
                    <Input className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1" placeholder="Acme Pay" value={form.brandName} onChange={e => update("brandName", e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label className="text-white/80">Organization Type *</Label>
                  <Select value={form.applicationType} onValueChange={v => update("applicationType", v)}>
                    <SelectTrigger className="bg-white/10 border-white/20 text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fintech_startup">Fintech Startup</SelectItem>
                      <SelectItem value="bank">Bank / Financial Institution</SelectItem>
                      <SelectItem value="mfi">Microfinance Institution</SelectItem>
                      <SelectItem value="ngo">NGO / Non-Profit</SelectItem>
                      <SelectItem value="telecom">Telecom / MNO</SelectItem>
                      <SelectItem value="aggregator">Payment Aggregator</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-white/80">Select Plan *</Label>
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    {(["starter", "growth", "enterprise", "white_label"] as const).map(plan => (
                      <div key={plan} onClick={() => update("requestedPlan", plan)} className={`cursor-pointer rounded-lg border p-3 transition-all ${form.requestedPlan === plan ? "border-violet-400 bg-violet-500/20" : "border-white/20 hover:border-white/40"}`}>
                        <div className="font-semibold text-sm capitalize mb-1">{plan.replace("_", " ")}</div>
                        <ul className="text-xs text-white/60 space-y-0.5">
                          {PLAN_FEATURES[plan].slice(0, 3).map(f => <li key={f}>• {f}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Step 2: Contact Details */}
            {step === 2 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/80">Contact Person Name *</Label>
                    <Input className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1" placeholder="John Doe" value={form.contactName} onChange={e => update("contactName", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-white/80">Contact Email *</Label>
                    <Input type="email" className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1" placeholder="john@acmefintech.com" value={form.contactEmail} onChange={e => update("contactEmail", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/80">Phone Number</Label>
                    <Input className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1" placeholder="+234 800 000 0000" value={form.contactPhone} onChange={e => update("contactPhone", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-white/80">Company Website</Label>
                    <Input className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1" placeholder="https://acmefintech.com" value={form.website} onChange={e => update("website", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/80">Country of Incorporation *</Label>
                    <Select value={form.country} onValueChange={v => update("country", v)}>
                      <SelectTrigger className="bg-white/10 border-white/20 text-white mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[["NG","Nigeria"],["GH","Ghana"],["KE","Kenya"],["ZA","South Africa"],["GB","United Kingdom"],["US","United States"],["CA","Canada"],["DE","Germany"],["FR","France"],["SG","Singapore"],["AE","UAE"],["IN","India"]].map(([code, name]) => (
                          <SelectItem key={code} value={code}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-white/80">Registration Number</Label>
                    <Input className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1" placeholder="RC-1234567" value={form.registrationNumber} onChange={e => update("registrationNumber", e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {/* Step 3: Business Details */}
            {step === 3 && (
              <>
                <div>
                  <Label className="text-white/80">Business Description * (min 50 chars)</Label>
                  <Textarea className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1 min-h-[100px]" placeholder="Describe your business model, target market, and how you plan to use RemitFlow..." value={form.businessDescription} onChange={e => update("businessDescription", e.target.value)} />
                  <p className="text-xs text-white/40 mt-1">{form.businessDescription.length}/2000 characters</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/80">Expected Monthly Volume (USD)</Label>
                    <Input type="number" className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1" placeholder="100000" value={form.expectedMonthlyVolume} onChange={e => update("expectedMonthlyVolume", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-white/80">Expected User Count</Label>
                    <Input type="number" className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1" placeholder="1000" value={form.expectedUserCount} onChange={e => update("expectedUserCount", e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label className="text-white/80">Target Corridors (select all that apply)</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                    {["NG→US", "NG→GB", "NG→CA", "GH→US", "KE→US", "ZA→US", "NG→EU", "GH→GB", "KE→GB", "NG→UAE", "NG→CN", "GH→EU"].map(corridor => (
                      <div key={corridor} onClick={() => toggleCorridor(corridor)} className={`cursor-pointer rounded border px-3 py-2 text-sm transition-all ${form.targetCorridors.includes(corridor) ? "border-violet-400 bg-violet-500/20 text-white" : "border-white/20 text-white/60 hover:border-white/40"}`}>
                        {corridor}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Step 4: Compliance */}
            {step === 4 && (
              <>
                <div className="space-y-4">
                  {[
                    { field: "hasAmlPolicy", label: "We have an AML/CFT Policy", desc: "Anti-Money Laundering and Counter-Financing of Terrorism policy" },
                    { field: "hasKycProcess", label: "We have a KYC Process", desc: "Know Your Customer onboarding and verification process" },
                    { field: "isRegulated", label: "We are regulated / licensed", desc: "Licensed by a financial regulatory authority" },
                  ].map(({ field, label, desc }) => (
                    <div key={field} className="flex items-start gap-3 p-3 rounded-lg border border-white/10 hover:border-white/20">
                      <Checkbox
                        checked={form[field as keyof typeof form] as boolean}
                        onCheckedChange={v => update(field, v)}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="font-medium text-sm">{label}</p>
                        <p className="text-xs text-white/50">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {form.isRegulated && (
                  <div>
                    <Label className="text-white/80">Regulatory Licenses (one per line)</Label>
                    <Textarea className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1" placeholder="CBN License No. ABC123&#10;FCA Registration No. XYZ456" onChange={e => update("regulatoryLicenses", e.target.value.split("\n").filter(Boolean))} />
                  </div>
                )}
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                  <p className="text-amber-300 text-sm font-medium mb-1">📋 Documents Required</p>
                  <p className="text-white/60 text-xs">After approval, you will be asked to upload: Business Registration Certificate, AML Policy Document, Director ID, and Bank Statement. You can upload these after submitting your application.</p>
                </div>
              </>
            )}

            {/* Step 5: Branding */}
            {step === 5 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/80">Primary Brand Color</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="color" value={form.primaryColor} onChange={e => update("primaryColor", e.target.value)} className="w-10 h-10 rounded cursor-pointer bg-transparent border-0" />
                      <Input className="bg-white/10 border-white/20 text-white" value={form.primaryColor} onChange={e => update("primaryColor", e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-white/80">Secondary Brand Color</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="color" value={form.secondaryColor} onChange={e => update("secondaryColor", e.target.value)} className="w-10 h-10 rounded cursor-pointer bg-transparent border-0" />
                      <Input className="bg-white/10 border-white/20 text-white" value={form.secondaryColor} onChange={e => update("secondaryColor", e.target.value)} />
                    </div>
                  </div>
                </div>
                {/* Brand preview */}
                <div className="rounded-lg overflow-hidden border border-white/20">
                  <div className="p-4 text-white font-bold text-lg" style={{ background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})` }}>
                    {form.brandName || "Your Brand"} Preview
                  </div>
                  <div className="bg-white/5 p-4">
                    <div className="flex gap-2">
                      <button className="px-4 py-2 rounded text-white text-sm font-medium" style={{ background: form.primaryColor }}>Send Money</button>
                      <button className="px-4 py-2 rounded text-sm font-medium border" style={{ borderColor: form.secondaryColor, color: form.secondaryColor }}>View Rates</button>
                    </div>
                  </div>
                </div>
                <p className="text-white/50 text-xs">You can upload your logo and customize further after approval in your partner dashboard.</p>
              </>
            )}

            {/* Step 6: Review */}
            {step === 6 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Company", form.companyName],
                    ["Brand", form.brandName],
                    ["Type", form.applicationType.replace("_", " ")],
                    ["Plan", form.requestedPlan.replace("_", " ")],
                    ["Contact", form.contactName],
                    ["Email", form.contactEmail],
                    ["Country", form.country],
                    ["Corridors", form.targetCorridors.length > 0 ? form.targetCorridors.join(", ") : "Not specified"],
                    ["AML Policy", form.hasAmlPolicy ? "Yes" : "No"],
                    ["KYC Process", form.hasKycProcess ? "Yes" : "No"],
                    ["Regulated", form.isRegulated ? "Yes" : "No"],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-white/5 rounded p-2">
                      <p className="text-white/40 text-xs">{label}</p>
                      <p className="text-white font-medium capitalize">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-4 text-sm text-white/70">
                  By submitting this application, you agree to RemitFlow's Partner Terms of Service and Privacy Policy. Our team will review your application within 2–3 business days.
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex justify-between mt-4">
          <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => step > 1 ? setStep(s => s - 1) : navigate("/")} disabled={submitMutation.isPending}>
            <ArrowLeft className="w-4 h-4 mr-2" /> {step === 1 ? "Cancel" : "Back"}
          </Button>
          {step < 6 ? (
            <Button className="bg-violet-600 hover:bg-violet-700" onClick={() => setStep(s => s + 1)}>
              Next <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleSubmit} disabled={submitMutation.isPending}>
              {submitMutation.isPending ? "Submitting..." : "Submit Application"} <Rocket className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </div>
  

    </DashboardLayout>

  );
}
