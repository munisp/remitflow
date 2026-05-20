import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, ArrowRight, ArrowLeft, Building2, Palette, Globe, BarChart3, Eye, Rocket, Lock, Shield, Zap, Users } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

// ─── Types ────────────────────────────────────────────────────────────────────
interface OnboardingData {
  sessionToken: string;
  plan: string;
  companyName: string;
  brandName: string;
  slug: string;
  supportEmail: string;
  website: string;
  country: string;
  defaultCurrency: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string;
  customDomain: string;
  showPoweredBy: boolean;
  termsUrl: string;
  privacyUrl: string;
  corridors: Array<{ fromCountry: string; toCountry: string; fromCurrency: string; toCurrency: string; feePercent: number; feeFixed: number; enabled: boolean }>;
  defaultFeePercent: number;
  defaultFeeFixed: number;
  maxTransferAmount: number;
  allowedCountries: string[];
  acceptTerms: boolean;
}

const STEPS = [
  { id: 1, label: "Invite Code", icon: Lock, description: "Verify your partner invite code" },
  { id: 2, label: "Company Info", icon: Building2, description: "Tell us about your company" },
  { id: 3, label: "Branding", icon: Palette, description: "Customize your platform look" },
  { id: 4, label: "Corridors", icon: Globe, description: "Configure transfer routes & fees" },
  { id: 5, label: "Review", icon: Eye, description: "Review your configuration" },
  { id: 6, label: "Launch", icon: Rocket, description: "Go live!" },
];

const PLAN_FEATURES: Record<string, string[]> = {
  starter: ["Up to 100 users", "5 corridors", "Basic analytics", "Email support", "$50K monthly volume"],
  growth: ["Up to 1,000 users", "20 corridors", "Advanced analytics", "Priority support", "$500K monthly volume"],
  enterprise: ["Unlimited users", "Unlimited corridors", "Custom analytics", "Dedicated support", "Unlimited volume"],
};

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "CAD", "AUD", "SGD", "AED", "INR"];
const COUNTRIES = [
  { code: "US", name: "United States" }, { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" }, { code: "AU", name: "Australia" },
  { code: "NG", name: "Nigeria" }, { code: "GH", name: "Ghana" },
  { code: "KE", name: "Kenya" }, { code: "ZA", name: "South Africa" },
  { code: "DE", name: "Germany" }, { code: "FR", name: "France" },
  { code: "AE", name: "UAE" }, { code: "SG", name: "Singapore" },
  { code: "IN", name: "India" }, { code: "PH", name: "Philippines" },
];

const DEFAULT_CORRIDORS = [
  { fromCountry: "US", toCountry: "NG", fromCurrency: "USD", toCurrency: "NGN", feePercent: 1.5, feeFixed: 2, enabled: true },
  { fromCountry: "GB", toCountry: "NG", fromCurrency: "GBP", toCurrency: "NGN", feePercent: 1.5, feeFixed: 2, enabled: true },
  { fromCountry: "CA", toCountry: "GH", fromCurrency: "CAD", toCurrency: "GHS", feePercent: 2.0, feeFixed: 3, enabled: true },
];

export default function PartnerOnboard() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [inviteCode, setInviteCode] = useState("");
  const [data, setData] = useState<Partial<OnboardingData>>({
    primaryColor: "#7c3aed",
    secondaryColor: "#06b6d4",
    accentColor: "#f59e0b",
    showPoweredBy: true,
    defaultFeePercent: 1.5,
    defaultFeeFixed: 2,
    maxTransferAmount: 10000,
    corridors: DEFAULT_CORRIDORS,
    allowedCountries: ["US", "GB", "CA", "AU", "NG", "GH", "KE"],
    acceptTerms: false,
    country: "US",
    defaultCurrency: "USD",
  });

  // Read ?code= from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) setInviteCode(code.toUpperCase());
  }, []);

  const verifyMutation = trpc.partnerOnboarding.verifyInviteCode.useMutation({
    onSuccess: (result) => {
      setData(prev => ({ ...prev, sessionToken: result.sessionToken, plan: result.plan }));
      toast.success(`✅ Invite code verified! ${result.plan.charAt(0).toUpperCase() + result.plan.slice(1)} plan activated.`);
      setStep(2);
    },
    onError: (e) => toast.error(e.message),
  });

  const saveCompanyMutation = trpc.partnerOnboarding.saveCompanyInfo.useMutation({
    onSuccess: () => { toast.success("Company info saved"); setStep(3); },
    onError: (e) => toast.error(e.message),
  });

  const saveBrandingMutation = trpc.partnerOnboarding.saveBranding.useMutation({
    onSuccess: () => { toast.success("Branding saved"); setStep(4); },
    onError: (e) => toast.error(e.message),
  });

  const saveCorridorsMutation = trpc.partnerOnboarding.saveCorridors.useMutation({
    onSuccess: () => { toast.success("Corridors configured"); setStep(5); },
    onError: (e) => toast.error(e.message),
  });

  const completeMutation = trpc.partnerOnboarding.completOnboarding.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      setStep(6);
      setTimeout(() => navigate(result.dashboardUrl), 2000);
    },
    onError: (e) => toast.error(e.message),
  });

  const update = (key: keyof OnboardingData, value: any) => setData(prev => ({ ...prev, [key]: value }));

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-950 via-slate-900 to-slate-950">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">RemitFlow</p>
              <p className="text-xs text-white/50">Partner Onboarding</p>
            </div>
          </div>
          <Badge variant="outline" className="border-violet-500/40 text-violet-300 text-xs">
            {data.plan ? `${data.plan.charAt(0).toUpperCase() + data.plan.slice(1)} Plan` : "Partner Portal"}
          </Badge>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Progress */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            {STEPS.map((s) => {
              const Icon = s.icon;
              const isCompleted = step > s.id;
              const isCurrent = step === s.id;
              return (
                <div key={s.id} className="flex flex-col items-center gap-1.5 flex-1">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                    isCompleted ? "bg-emerald-500 text-white" :
                    isCurrent ? "bg-violet-600 text-white ring-4 ring-violet-500/30" :
                    "bg-white/10 text-white/40"
                  }`}>
                    {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${isCurrent ? "text-violet-300" : isCompleted ? "text-emerald-400" : "text-white/30"}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <Progress value={progress} className="h-1.5 bg-white/10" />
        </div>

        {/* Step 1: Verify Invite Code */}
        {step === 1 && (
          <div className="max-w-lg mx-auto">
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader className="text-center pb-2">
                <div className="w-16 h-16 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center mx-auto mb-4">
                  <Lock className="w-8 h-8 text-violet-400" />
                </div>
                <CardTitle className="text-white text-2xl">Enter Your Invite Code</CardTitle>
                <CardDescription className="text-white/60">
                  RemitFlow white-label onboarding is invite-only. Enter the partner code you received to get started.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Partner Invite Code</Label>
                  <Input
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="RF-XXXX-XXXX-XXXX-XXXX"
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 font-mono text-center text-lg tracking-widest h-12"
                    onKeyDown={(e) => e.key === "Enter" && inviteCode && verifyMutation.mutate({ code: inviteCode })}
                  />
                  <p className="text-xs text-white/40 text-center">Contact your RemitFlow account manager to receive an invite code</p>
                </div>

                <Button
                  className="w-full h-12 bg-violet-600 hover:bg-violet-700 text-white font-semibold"
                  disabled={!inviteCode || verifyMutation.isPending}
                  onClick={() => verifyMutation.mutate({ code: inviteCode })}
                >
                  {verifyMutation.isPending ? "Verifying..." : "Verify & Continue"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>

                {/* Feature highlights */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {[
                    { icon: Shield, text: "Bank-grade security" },
                    { icon: Globe, text: "50+ corridors" },
                    { icon: Users, text: "Multi-tenant ready" },
                    { icon: BarChart3, text: "Real-time analytics" },
                  ].map(({ icon: Icon, text }) => (
                    <div key={text} className="flex items-center gap-2 text-white/50 text-xs">
                      <Icon className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                      {text}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 2: Company Info */}
        {step === 2 && (
          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-violet-400" /> Company Information
              </CardTitle>
              <CardDescription className="text-white/60">Tell us about your business</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label className="text-white/80">Legal Company Name *</Label>
                  <Input value={data.companyName ?? ""} onChange={e => update("companyName", e.target.value)}
                    placeholder="Acme Financial Ltd" className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Brand Name (shown to users) *</Label>
                  <Input value={data.brandName ?? ""} onChange={e => update("brandName", e.target.value)}
                    placeholder="AcmePay" className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Platform Slug (URL identifier) *</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-white/40 text-sm shrink-0">remitflow.app/</span>
                    <Input value={data.slug ?? ""} onChange={e => update("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      placeholder="acmepay" className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                  </div>
                  <p className="text-xs text-white/40">Lowercase letters, numbers, and hyphens only</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Support Email *</Label>
                  <Input type="email" value={data.supportEmail ?? ""} onChange={e => update("supportEmail", e.target.value)}
                    placeholder="support@acmepay.com" className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Website</Label>
                  <Input type="url" value={data.website ?? ""} onChange={e => update("website", e.target.value)}
                    placeholder="https://acmepay.com" className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Country of Registration *</Label>
                  <Select value={data.country} onValueChange={v => update("country", v)}>
                    <SelectTrigger className="bg-white/10 border-white/20 text-white">
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Default Currency *</Label>
                  <Select value={data.defaultCurrency} onValueChange={v => update("defaultCurrency", v)}>
                    <SelectTrigger className="bg-white/10 border-white/20 text-white">
                      <SelectValue placeholder="Select currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-white/80">Company Description</Label>
                  <Textarea value={data.description ?? ""} onChange={e => update("description", e.target.value)}
                    placeholder="Brief description of your remittance business..." rows={3}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 resize-none" />
                </div>
              </div>

              {/* Plan features reminder */}
              {data.plan && (
                <div className="rounded-xl bg-violet-600/10 border border-violet-500/20 p-4">
                  <p className="text-violet-300 font-medium text-sm mb-2 capitalize">{data.plan} Plan Features</p>
                  <div className="grid grid-cols-2 gap-1">
                    {(PLAN_FEATURES[data.plan] ?? []).map(f => (
                      <div key={f} className="flex items-center gap-1.5 text-white/60 text-xs">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" /> {f}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep(1)} className="border-white/20 text-white/70 hover:bg-white/10">
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back
                </Button>
                <Button
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={!data.companyName || !data.brandName || !data.slug || !data.supportEmail || saveCompanyMutation.isPending}
                  onClick={() => saveCompanyMutation.mutate({
                    sessionToken: data.sessionToken!,
                    companyName: data.companyName!,
                    brandName: data.brandName!,
                    slug: data.slug!,
                    supportEmail: data.supportEmail!,
                    website: data.website || undefined,
                    country: data.country!,
                    defaultCurrency: data.defaultCurrency!,
                    description: data.description || undefined,
                  })}
                >
                  {saveCompanyMutation.isPending ? "Saving..." : "Continue to Branding"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Branding */}
        {step === 3 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Palette className="w-5 h-5 text-violet-400" /> Brand Customization
                </CardTitle>
                <CardDescription className="text-white/60">Make it yours</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { key: "primaryColor", label: "Primary" },
                    { key: "secondaryColor", label: "Secondary" },
                    { key: "accentColor", label: "Accent" },
                  ].map(({ key, label }) => (
                    <div key={key} className="space-y-2">
                      <Label className="text-white/80 text-xs">{label}</Label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={(data as any)[key]} onChange={e => update(key as any, e.target.value)}
                          className="w-10 h-10 rounded-lg border border-white/20 cursor-pointer bg-transparent" />
                        <Input value={(data as any)[key]} onChange={e => update(key as any, e.target.value)}
                          className="bg-white/10 border-white/20 text-white text-xs font-mono h-10" />
                      </div>
                    </div>
                  ))}
                </div>

                <Separator className="bg-white/10" />

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-white/80">Logo URL</Label>
                    <Input value={data.logoUrl ?? ""} onChange={e => update("logoUrl", e.target.value)}
                      placeholder="https://cdn.example.com/logo.png" className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Custom Domain</Label>
                    <Input value={data.customDomain ?? ""} onChange={e => update("customDomain", e.target.value)}
                      placeholder="pay.yourdomain.com" className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Terms of Service URL</Label>
                    <Input value={data.termsUrl ?? ""} onChange={e => update("termsUrl", e.target.value)}
                      placeholder="https://yourdomain.com/terms" className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Privacy Policy URL</Label>
                    <Input value={data.privacyUrl ?? ""} onChange={e => update("privacyUrl", e.target.value)}
                      placeholder="https://yourdomain.com/privacy" className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-white/80 text-sm font-medium">Show "Powered by RemitFlow"</p>
                      <p className="text-white/40 text-xs">Display attribution in your platform footer</p>
                    </div>
                    <Switch checked={data.showPoweredBy ?? true} onCheckedChange={v => update("showPoweredBy", v)} />
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setStep(2)} className="border-white/20 text-white/70 hover:bg-white/10">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                  </Button>
                  <Button
                    className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                    disabled={saveBrandingMutation.isPending}
                    onClick={() => saveBrandingMutation.mutate({
                      sessionToken: data.sessionToken!,
                      primaryColor: data.primaryColor!,
                      secondaryColor: data.secondaryColor!,
                      accentColor: data.accentColor!,
                      logoUrl: data.logoUrl || undefined,
                      customDomain: data.customDomain || undefined,
                      showPoweredBy: data.showPoweredBy ?? true,
                      termsUrl: data.termsUrl || undefined,
                      privacyUrl: data.privacyUrl || undefined,
                    })}
                  >
                    {saveBrandingMutation.isPending ? "Saving..." : "Continue to Corridors"}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Live Preview */}
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white text-sm flex items-center gap-2">
                  <Eye className="w-4 h-4 text-violet-400" /> Live Preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl overflow-hidden border border-white/10" style={{ background: "#0f0f0f" }}>
                  {/* Mock app header */}
                  <div className="px-4 py-3 flex items-center gap-2" style={{ background: data.primaryColor + "22", borderBottom: `1px solid ${data.primaryColor}33` }}>
                    {data.logoUrl ? (
                      <img src={data.logoUrl} alt="logo" className="w-7 h-7 rounded-lg object-contain" />
                    ) : (
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: data.primaryColor }}>
                        {(data.brandName ?? "B").charAt(0)}
                      </div>
                    )}
                    <span className="text-white font-semibold text-sm">{data.brandName || "Your Brand"}</span>
                  </div>
                  {/* Mock dashboard */}
                  <div className="p-4 space-y-3">
                    <div className="rounded-lg p-3" style={{ background: data.primaryColor + "15", border: `1px solid ${data.primaryColor}30` }}>
                      <p className="text-white/50 text-xs">Total Balance</p>
                      <p className="text-white font-bold text-xl">$12,450.00</p>
                      <p className="text-xs mt-1" style={{ color: data.accentColor }}>↑ +2.4% this month</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button className="rounded-lg p-2.5 text-white text-xs font-medium" style={{ background: data.primaryColor }}>
                        Send Money
                      </button>
                      <button className="rounded-lg p-2.5 text-xs font-medium" style={{ background: data.secondaryColor + "20", color: data.secondaryColor, border: `1px solid ${data.secondaryColor}40` }}>
                        Receive
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {["Transfer to Lagos", "Top-up Wallet", "FX Exchange"].map((item, i) => (
                        <div key={item} className="flex items-center justify-between rounded-lg px-3 py-2 bg-white/5">
                          <span className="text-white/70 text-xs">{item}</span>
                          <span className="text-xs font-medium" style={{ color: i === 0 ? "#ef4444" : "#22c55e" }}>
                            {i === 0 ? "-$250" : "+$500"}
                          </span>
                        </div>
                      ))}
                    </div>
                    {data.showPoweredBy && (
                      <p className="text-center text-white/20 text-xs pt-1">Powered by RemitFlow</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 4: Corridors */}
        {step === 4 && (
          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-violet-400" /> Transfer Corridors & Fees
              </CardTitle>
              <CardDescription className="text-white/60">Configure the countries and currencies your platform will support</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Default fees */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="space-y-2">
                  <Label className="text-white/80 text-sm">Default Fee %</Label>
                  <Input type="number" min="0" max="10" step="0.1" value={data.defaultFeePercent ?? 1.5}
                    onChange={e => update("defaultFeePercent", parseFloat(e.target.value))}
                    className="bg-white/10 border-white/20 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80 text-sm">Default Fixed Fee ($)</Label>
                  <Input type="number" min="0" step="0.5" value={data.defaultFeeFixed ?? 2}
                    onChange={e => update("defaultFeeFixed", parseFloat(e.target.value))}
                    className="bg-white/10 border-white/20 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80 text-sm">Max Transfer ($)</Label>
                  <Input type="number" min="100" step="1000" value={data.maxTransferAmount ?? 10000}
                    onChange={e => update("maxTransferAmount", parseInt(e.target.value))}
                    className="bg-white/10 border-white/20 text-white" />
                </div>
              </div>

              {/* Corridors table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-white/80 text-sm font-medium">Active Corridors</p>
                  <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:bg-white/10 text-xs"
                    onClick={() => update("corridors", [...(data.corridors ?? []), { fromCountry: "US", toCountry: "NG", fromCurrency: "USD", toCurrency: "NGN", feePercent: 1.5, feeFixed: 2, enabled: true }])}>
                    + Add Corridor
                  </Button>
                </div>
                <div className="space-y-2">
                  {(data.corridors ?? []).map((corridor, idx) => (
                    <div key={idx} className="grid grid-cols-7 gap-2 items-center p-3 rounded-lg bg-white/5 border border-white/10">
                      <Select value={corridor.fromCountry} onValueChange={v => {
                        const updated = [...(data.corridors ?? [])];
                        updated[idx] = { ...updated[idx], fromCountry: v };
                        update("corridors", updated);
                      }}>
                        <SelectTrigger className="bg-white/10 border-white/20 text-white text-xs h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>{COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-white/40 text-center text-xs">→</span>
                      <Select value={corridor.toCountry} onValueChange={v => {
                        const updated = [...(data.corridors ?? [])];
                        updated[idx] = { ...updated[idx], toCountry: v };
                        update("corridors", updated);
                      }}>
                        <SelectTrigger className="bg-white/10 border-white/20 text-white text-xs h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>{COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input type="number" min="0" max="10" step="0.1" value={corridor.feePercent}
                        onChange={e => { const u = [...(data.corridors ?? [])]; u[idx] = { ...u[idx], feePercent: parseFloat(e.target.value) }; update("corridors", u); }}
                        className="bg-white/10 border-white/20 text-white text-xs h-8" placeholder="Fee %" />
                      <Input type="number" min="0" step="0.5" value={corridor.feeFixed}
                        onChange={e => { const u = [...(data.corridors ?? [])]; u[idx] = { ...u[idx], feeFixed: parseFloat(e.target.value) }; update("corridors", u); }}
                        className="bg-white/10 border-white/20 text-white text-xs h-8" placeholder="Fixed $" />
                      <Switch checked={corridor.enabled} onCheckedChange={v => { const u = [...(data.corridors ?? [])]; u[idx] = { ...u[idx], enabled: v }; update("corridors", u); }} />
                      <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-8 w-8 p-0"
                        onClick={() => update("corridors", (data.corridors ?? []).filter((_, i) => i !== idx))}>×</Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep(3)} className="border-white/20 text-white/70 hover:bg-white/10">
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back
                </Button>
                <Button
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={!data.corridors?.length || saveCorridorsMutation.isPending}
                  onClick={() => saveCorridorsMutation.mutate({
                    sessionToken: data.sessionToken!,
                    corridors: data.corridors!,
                    defaultFeePercent: data.defaultFeePercent!,
                    defaultFeeFixed: data.defaultFeeFixed!,
                    maxTransferAmount: data.maxTransferAmount!,
                    allowedCountries: data.allowedCountries!,
                  })}
                >
                  {saveCorridorsMutation.isPending ? "Saving..." : "Review Configuration"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 5: Review */}
        {step === 5 && (
          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Eye className="w-5 h-5 text-violet-400" /> Review Your Configuration
              </CardTitle>
              <CardDescription className="text-white/60">Everything looks good? Let's launch your platform.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Company */}
                <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-violet-400" />
                    <p className="text-white font-medium text-sm">Company</p>
                    <button onClick={() => setStep(2)} className="ml-auto text-violet-400 hover:text-violet-300 text-xs">Edit</button>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-white/50">Company</span><span className="text-white">{data.companyName}</span></div>
                    <div className="flex justify-between"><span className="text-white/50">Brand</span><span className="text-white">{data.brandName}</span></div>
                    <div className="flex justify-between"><span className="text-white/50">Slug</span><span className="text-violet-300">/{data.slug}</span></div>
                    <div className="flex justify-between"><span className="text-white/50">Plan</span><Badge className="text-xs capitalize bg-violet-600/20 text-violet-300 border-violet-500/30">{data.plan}</Badge></div>
                  </div>
                </div>
                {/* Branding */}
                <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-violet-400" />
                    <p className="text-white font-medium text-sm">Branding</p>
                    <button onClick={() => setStep(3)} className="ml-auto text-violet-400 hover:text-violet-300 text-xs">Edit</button>
                  </div>
                  <div className="flex gap-2">
                    {[data.primaryColor, data.secondaryColor, data.accentColor].map((c, i) => (
                      <div key={i} className="w-8 h-8 rounded-lg border border-white/20" style={{ background: c }} title={c} />
                    ))}
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-white/50">Domain</span><span className="text-white">{data.customDomain || "Default"}</span></div>
                    <div className="flex justify-between"><span className="text-white/50">Powered by</span><span className="text-white">{data.showPoweredBy ? "Shown" : "Hidden"}</span></div>
                  </div>
                </div>
                {/* Corridors */}
                <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-violet-400" />
                    <p className="text-white font-medium text-sm">Corridors</p>
                    <button onClick={() => setStep(4)} className="ml-auto text-violet-400 hover:text-violet-300 text-xs">Edit</button>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-white/50">Corridors</span><span className="text-white">{data.corridors?.filter(c => c.enabled).length} active</span></div>
                    <div className="flex justify-between"><span className="text-white/50">Default fee</span><span className="text-white">{data.defaultFeePercent}% + ${data.defaultFeeFixed}</span></div>
                    <div className="flex justify-between"><span className="text-white/50">Max transfer</span><span className="text-white">${data.maxTransferAmount?.toLocaleString()}</span></div>
                  </div>
                </div>
              </div>

              {/* Auth check */}
              {!user ? (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4">
                  <p className="text-amber-300 font-medium text-sm mb-2">Sign in to complete setup</p>
                  <p className="text-amber-200/60 text-xs mb-3">You need to be signed in to create your tenant account.</p>
                  <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => window.location.href = getLoginUrl("/partner/onboard")}>
                    Sign In to Continue
                  </Button>
                </div>
              ) : (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-emerald-300 font-medium text-sm">Signed in as {user.name}</p>
                    <p className="text-emerald-200/60 text-xs">Your account will be set as the tenant admin.</p>
                  </div>
                </div>
              )}

              {/* Terms */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                <Switch checked={data.acceptTerms ?? false} onCheckedChange={v => update("acceptTerms", v)} />
                <div>
                  <p className="text-white/80 text-sm">I accept the RemitFlow Partner Terms of Service and understand that this creates a legally binding agreement.</p>
                  <a href="#" className="text-violet-400 text-xs hover:underline">Read Partner Agreement →</a>
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(4)} className="border-white/20 text-white/70 hover:bg-white/10">
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back
                </Button>
                <Button
                  className="flex-1 h-12 bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white font-semibold"
                  disabled={!data.acceptTerms || !user || completeMutation.isPending}
                  onClick={() => completeMutation.mutate({ sessionToken: data.sessionToken!, acceptTerms: true })}
                >
                  {completeMutation.isPending ? "Creating your platform..." : "🚀 Launch My Platform"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 6: Success */}
        {step === 6 && (
          <div className="max-w-lg mx-auto text-center">
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardContent className="pt-10 pb-8 space-y-6">
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-white text-2xl font-bold mb-2">Platform Created! 🎉</h2>
                  <p className="text-white/60">
                    <strong className="text-white">{data.brandName}</strong> is live. Redirecting to your tenant dashboard...
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-left">
                  {[
                    { label: "Platform URL", value: `/${data.slug}` },
                    { label: "Plan", value: data.plan ?? "starter" },
                    { label: "Corridors", value: `${data.corridors?.filter(c => c.enabled).length} active` },
                    { label: "Status", value: "Trial (14 days)" },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg bg-white/5 p-3">
                      <p className="text-white/40 text-xs">{label}</p>
                      <p className="text-white font-medium text-sm capitalize">{value}</p>
                    </div>
                  ))}
                </div>
                <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => navigate(`/tenant/${data.slug}/dashboard`)}>
                  Go to Dashboard <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
