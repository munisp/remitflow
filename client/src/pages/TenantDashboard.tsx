import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import {  Building2, Palette, Users, Globe, BarChart3, Settings, ArrowLeft,
  CheckCircle2, AlertCircle, Zap, TrendingUp, Activity, Shield,
  Copy, ExternalLink, Trash2, Crown, UserMinus, RefreshCw,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function TenantDashboard() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/tenant/:slug/dashboard");
  const slug = (params as any)?.slug ?? "";
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [brandingEdit, setBrandingEdit] = useState(false);
  const [brandingData, setBrandingData] = useState<Record<string, any>>({});

  const { data: tenant, refetch: refetchTenant, isLoading } = trpc.partnerOnboarding.getTenant.useQuery(
    { slug },
    { enabled: !!slug && !!user }
  );

  const { data: members = [], refetch: refetchMembers } = trpc.partnerOnboarding.getTenantMembers.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant?.id }
  );

  const { data: analytics } = trpc.partnerOnboarding.getTenantAnalytics.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant?.id }
  );

  const { data: wlConfig } = trpc.partnerOnboarding.getWhiteLabelConfig.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant?.id }
  );

  const updateBrandingMutation = trpc.partnerOnboarding.updateTenantBranding.useMutation({
    onSuccess: () => { toast.success("Branding updated"); setBrandingEdit(false); refetchTenant(); },
    onError: (e) => toast.error(e.message),
  });

  const updateWLMutation = trpc.partnerOnboarding.updateWhiteLabelConfig.useMutation({
    onSuccess: () => { toast.success("White-label config updated"); },
    onError: (e) => toast.error(e.message),
  });

  const removeMemberMutation = trpc.partnerOnboarding.removeTenantMember.useMutation({
    onSuccess: () => { toast.success("Member removed"); refetchMembers(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-white/50 text-sm">Loading tenant dashboard...</p>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Card className="bg-white/5 border-white/10 max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            <h2 className="text-white font-bold text-lg">Tenant Not Found</h2>
            <p className="text-white/50 text-sm">The tenant "{slug}" doesn't exist or you don't have access.</p>
            <Button onClick={() => navigate("/partner/my-tenants")} className="bg-violet-600 hover:bg-violet-700 text-white">
              View My Tenants
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    trial: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    active: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    suspended: "bg-red-500/20 text-red-300 border-red-500/30",
    cancelled: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  };

  return (

    <DashboardLayout>
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/30 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/partner/my-tenants")}
              className="text-white/50 hover:text-white hover:bg-white/10">
              <ArrowLeft className="w-4 h-4 mr-1" /> My Tenants
            </Button>
            <Separator orientation="vertical" className="h-5 bg-white/10" />
            <div className="flex items-center gap-3">
              {tenant.logoUrl ? (
                <img src={tenant.logoUrl} alt="logo" className="w-8 h-8 rounded-lg object-contain" />
              ) : (
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ background: tenant.primaryColor ?? "#7c3aed" }}>
                  {tenant.brandName?.charAt(0) ?? "T"}
                </div>
              )}
              <div>
                <p className="text-white font-semibold text-sm">{tenant.brandName}</p>
                <p className="text-white/40 text-xs">/{tenant.slug}</p>
              </div>
            </div>
            <Badge className={`text-xs capitalize ${statusColor[tenant.status ?? "trial"]}`}>
              {tenant.status}
            </Badge>
            <Badge variant="outline" className="border-violet-500/30 text-violet-300 text-xs capitalize">
              {tenant.plan}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {tenant.customDomain && (
              <Button variant="ghost" size="sm" className="text-white/50 hover:text-white hover:bg-white/10 text-xs gap-1"
                onClick={() => window.open(`https://${tenant.customDomain}`, "_blank")}>
                <ExternalLink className="w-3.5 h-3.5" /> Visit Site
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-white/50 hover:text-white hover:bg-white/10"
              onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/partner/onboard?tenant=${slug}`); toast.success("Invite link copied!"); }}>
              <Copy className="w-3.5 h-3.5 mr-1" /> Copy Invite Link
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white/5 border border-white/10 mb-8">
            {[
              { id: "overview", icon: BarChart3, label: "Overview" },
              { id: "branding", icon: Palette, label: "Branding" },
              { id: "members", icon: Users, label: "Members" },
              { id: "whitelabel", icon: Globe, label: "White Label" },
              { id: "settings", icon: Settings, label: "Settings" },
            ].map(({ id, icon: Icon, label }) => (
              <TabsTrigger key={id} value={id} className="text-white/60 data-[state=active]:text-white data-[state=active]:bg-white/10 gap-1.5 text-xs">
                <Icon className="w-3.5 h-3.5" /> {label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Overview ─────────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Members", value: analytics?.totalMembers ?? 0, icon: Users, color: "violet" },
                { label: "Monthly Volume", value: `$${((analytics?.monthlyVolume ?? 0) / 1000).toFixed(1)}K`, icon: TrendingUp, color: "emerald" },
                { label: "Success Rate", value: `${analytics?.successRate ?? 99.2}%`, icon: CheckCircle2, color: "blue" },
                { label: "Avg Transfer Time", value: analytics?.avgTransferTime ?? "2.3 min", icon: Activity, color: "amber" },
              ].map(({ label, value, icon: Icon, color }) => (
                <Card key={label} className="bg-white/5 border-white/10">
                  <CardContent className="pt-5 pb-4">
                    <div className={`w-8 h-8 rounded-lg bg-${color}-500/20 flex items-center justify-center mb-3`}>
                      <Icon className={`w-4 h-4 text-${color}-400`} />
                    </div>
                    <p className="text-2xl font-bold text-white">{value}</p>
                    <p className="text-white/50 text-xs mt-0.5">{label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Top corridors */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white text-sm flex items-center gap-2">
                  <Globe className="w-4 h-4 text-violet-400" /> Top Corridors
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(analytics?.topCorridors ?? []).map((corridor: any, i: number) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-white/40 text-xs w-4">{i + 1}</span>
                        <span className="text-white text-sm font-medium">{corridor.from} → {corridor.to}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-white/60 text-xs">{corridor.count} transfers</span>
                        <span className="text-emerald-400 text-sm font-medium">${corridor.volume.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                  {!analytics?.topCorridors?.length && (
                    <p className="text-white/30 text-sm text-center py-4">No transfers yet</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Quick info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="bg-white/5 border-white/10">
                <CardHeader><CardTitle className="text-white text-sm">Platform Details</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { label: "Company", value: tenant.name },
                    { label: "Support Email", value: tenant.supportEmail },
                    { label: "Currency", value: tenant.defaultCurrency },
                    { label: "Max Volume", value: `$${Number(tenant.maxMonthlyVolume ?? 0).toLocaleString()}/mo` },
                    { label: "Created", value: new Date(tenant.createdAt).toLocaleDateString() },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-white/50">{label}</span>
                      <span className="text-white">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="bg-white/5 border-white/10">
                <CardHeader><CardTitle className="text-white text-sm">Security & Compliance</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { label: "KYC Required", value: "Yes", ok: true },
                    { label: "AML Screening", value: "Active", ok: true },
                    { label: "Travel Rule", value: "Enabled", ok: true },
                    { label: "2FA Policy", value: "Enforced", ok: true },
                    { label: "Data Encryption", value: "AES-256", ok: true },
                  ].map(({ label, value, ok }) => (
                    <div key={label} className="flex justify-between text-sm items-center">
                      <span className="text-white/50">{label}</span>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-300 text-xs">{value}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Branding ─────────────────────────────────────────────────────── */}
          <TabsContent value="branding" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-white/5 border-white/10">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-white text-sm">Brand Settings</CardTitle>
                    <CardDescription className="text-white/50 text-xs">Customize your platform appearance</CardDescription>
                  </div>
                  {!brandingEdit && (
                    <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:bg-white/10 text-xs"
                      onClick={() => { setBrandingData({ ...tenant }); setBrandingEdit(true); }}>
                      Edit
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {brandingEdit ? (
                    <>
                      <div className="space-y-2">
                        <Label className="text-white/80 text-xs">Brand Name</Label>
                        <Input value={brandingData.brandName ?? ""} onChange={e => setBrandingData((p: any) => ({ ...p, brandName: e.target.value }))}
                          className="bg-white/10 border-white/20 text-white h-9 text-sm" />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { key: "primaryColor", label: "Primary" },
                          { key: "secondaryColor", label: "Secondary" },
                          { key: "accentColor", label: "Accent" },
                        ].map(({ key, label }) => (
                          <div key={key} className="space-y-1.5">
                            <Label className="text-white/80 text-xs">{label}</Label>
                            <div className="flex items-center gap-1.5">
                              <input type="color" value={brandingData[key] ?? "#7c3aed"}
                                onChange={e => setBrandingData((p: any) => ({ ...p, [key]: e.target.value }))}
                                className="w-8 h-8 rounded border border-white/20 cursor-pointer bg-transparent" />
                              <Input value={brandingData[key] ?? ""} onChange={e => setBrandingData((p: any) => ({ ...p, [key]: e.target.value }))}
                                className="bg-white/10 border-white/20 text-white text-xs font-mono h-8" />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-2">
                        <Label className="text-white/80 text-xs">Logo URL</Label>
                        <Input value={brandingData.logoUrl ?? ""} onChange={e => setBrandingData((p: any) => ({ ...p, logoUrl: e.target.value }))}
                          placeholder="https://cdn.example.com/logo.png" className="bg-white/10 border-white/20 text-white h-9 text-sm placeholder:text-white/30" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-white/80 text-xs">Custom Domain</Label>
                        <Input value={brandingData.customDomain ?? ""} onChange={e => setBrandingData((p: any) => ({ ...p, customDomain: e.target.value }))}
                          placeholder="pay.yourdomain.com" className="bg-white/10 border-white/20 text-white h-9 text-sm placeholder:text-white/30" />
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button variant="outline" size="sm" onClick={() => setBrandingEdit(false)} className="border-white/20 text-white/70 hover:bg-white/10 text-xs">Cancel</Button>
                        <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white text-xs"
                          disabled={updateBrandingMutation.isPending}
                          onClick={() => updateBrandingMutation.mutate({ tenantId: tenant.id, ...brandingData })}>
                          {updateBrandingMutation.isPending ? "Saving..." : "Save Changes"}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        {tenant.logoUrl ? (
                          <img src={tenant.logoUrl} alt="logo" className="w-12 h-12 rounded-xl object-contain border border-white/10" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg"
                            style={{ background: tenant.primaryColor ?? "#7c3aed" }}>
                            {tenant.brandName?.charAt(0)}
                          </div>
                        )}
                        <div>
                          <p className="text-white font-medium">{tenant.brandName}</p>
                          <p className="text-white/40 text-xs">{tenant.customDomain ?? "No custom domain"}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {[tenant.primaryColor, tenant.secondaryColor, tenant.accentColor].filter(Boolean).map((c, i) => (
                          <div key={i} className="w-8 h-8 rounded-lg border border-white/20" style={{ background: c ?? "#7c3aed" }} title={c ?? ""} />
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Live preview */}
              <Card className="bg-white/5 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-sm">Live Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-xl overflow-hidden border border-white/10" style={{ background: "#0f0f0f" }}>
                    <div className="px-4 py-3 flex items-center gap-2" style={{ background: (brandingEdit ? brandingData.primaryColor : tenant.primaryColor ?? "#7c3aed") + "22" }}>
                      <div className="w-6 h-6 rounded-md flex items-center justify-center text-white text-xs font-bold"
                        style={{ background: brandingEdit ? brandingData.primaryColor : tenant.primaryColor ?? "#7c3aed" }}>
                        {(brandingEdit ? brandingData.brandName : tenant.brandName)?.charAt(0) ?? "T"}
                      </div>
                      <span className="text-white font-semibold text-xs">{brandingEdit ? brandingData.brandName : tenant.brandName}</span>
                    </div>
                    <div className="p-4 space-y-2">
                      <div className="rounded-lg p-3" style={{ background: (brandingEdit ? brandingData.primaryColor : tenant.primaryColor ?? "#7c3aed") + "15" }}>
                        <p className="text-white/50 text-xs">Balance</p>
                        <p className="text-white font-bold">$12,450.00</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button className="rounded-lg p-2 text-white text-xs font-medium"
                          style={{ background: brandingEdit ? brandingData.primaryColor : tenant.primaryColor ?? "#7c3aed" }}>Send</button>
                        <button className="rounded-lg p-2 text-xs font-medium"
                          style={{ background: (brandingEdit ? brandingData.secondaryColor : tenant.secondaryColor ?? "#06b6d4") + "20", color: brandingEdit ? brandingData.secondaryColor : tenant.secondaryColor ?? "#06b6d4" }}>Receive</button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Members ──────────────────────────────────────────────────────── */}
          <TabsContent value="members" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-medium">Team Members</h3>
                <p className="text-white/50 text-xs mt-0.5">{members.length} member{members.length !== 1 ? "s" : ""}</p>
              </div>
              <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:bg-white/10 text-xs gap-1.5"
                onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/partner/join/${slug}`); toast.success("Member invite link copied!"); }}>
                <Copy className="w-3.5 h-3.5" /> Copy Invite Link
              </Button>
            </div>

            <div className="space-y-2">
              {members.map((member: any) => (
                <div key={member.id} className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-9 h-9">
                      <AvatarFallback className="bg-violet-600/30 text-violet-300 text-sm">
                        {member.name?.charAt(0) ?? "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-white text-sm font-medium">{member.name}</p>
                      <p className="text-white/40 text-xs">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={`text-xs capitalize ${member.role === "admin" ? "bg-violet-500/20 text-violet-300 border-violet-500/30" : "bg-white/10 text-white/60 border-white/20"}`}>
                      {member.role === "admin" && <Crown className="w-3 h-3 mr-1" />}
                      {member.role}
                    </Badge>
                    <span className="text-white/30 text-xs">{new Date(member.joinedAt).toLocaleDateString()}</span>
                    {member.userId !== user?.id && tenant.role === "admin" && (
                      <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 w-7 p-0"
                        onClick={() => removeMemberMutation.mutate({ tenantId: tenant.id, targetUserId: member.userId })}>
                        <UserMinus className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {!members.length && (
                <div className="text-center py-10 text-white/30">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No members yet</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── White Label ───────────────────────────────────────────────────── */}
          <TabsContent value="whitelabel" className="space-y-4">
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white text-sm flex items-center gap-2">
                  <Globe className="w-4 h-4 text-violet-400" /> White Label Configuration
                </CardTitle>
                <CardDescription className="text-white/50 text-xs">Control how your branded platform behaves</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {[
                  { key: "showPoweredBy", label: "Show 'Powered by RemitFlow'", desc: "Display RemitFlow attribution in your platform footer" },
                  { key: "requireInviteCode", label: "Require Invite Code for Registration", desc: "New users must have an invite code to sign up" },
                  { key: "allowSelfRegistration", label: "Allow Self-Registration", desc: "Users can register without an invitation" },
                ].map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div>
                      <p className="text-white/80 text-sm font-medium">{label}</p>
                      <p className="text-white/40 text-xs">{desc}</p>
                    </div>
                    <Switch
                      checked={(wlConfig as any)?.[key] ?? false}
                      onCheckedChange={v => wlConfig && updateWLMutation.mutate({ tenantId: tenant.id, [key]: v })}
                    />
                  </div>
                ))}

                <Separator className="bg-white/10" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white/80 text-xs">Terms of Service URL</Label>
                    <Input defaultValue={wlConfig?.termsUrl ?? ""} placeholder="https://yourdomain.com/terms"
                      className="bg-white/10 border-white/20 text-white h-9 text-sm placeholder:text-white/30"
                      onBlur={e => wlConfig && updateWLMutation.mutate({ tenantId: tenant.id, termsUrl: e.target.value || null })} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80 text-xs">Privacy Policy URL</Label>
                    <Input defaultValue={wlConfig?.privacyUrl ?? ""} placeholder="https://yourdomain.com/privacy"
                      className="bg-white/10 border-white/20 text-white h-9 text-sm placeholder:text-white/30"
                      onBlur={e => wlConfig && updateWLMutation.mutate({ tenantId: tenant.id, privacyUrl: e.target.value || null })} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80 text-xs">Google Analytics ID</Label>
                    <Input defaultValue={wlConfig?.gaTrackingId ?? ""} placeholder="G-XXXXXXXXXX"
                      className="bg-white/10 border-white/20 text-white h-9 text-sm placeholder:text-white/30"
                      onBlur={e => wlConfig && updateWLMutation.mutate({ tenantId: tenant.id, gaTrackingId: e.target.value || null })} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80 text-xs">Welcome Email Subject</Label>
                    <Input defaultValue={wlConfig?.welcomeEmailSubject ?? ""} placeholder="Welcome to {brandName}!"
                      className="bg-white/10 border-white/20 text-white h-9 text-sm placeholder:text-white/30"
                      onBlur={e => wlConfig && updateWLMutation.mutate({ tenantId: tenant.id, welcomeEmailSubject: e.target.value })} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Settings ─────────────────────────────────────────────────────── */}
          <TabsContent value="settings" className="space-y-4">
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white text-sm flex items-center gap-2">
                  <Shield className="w-4 h-4 text-violet-400" /> Platform Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4">
                  <p className="text-amber-300 font-medium text-sm mb-1">Trial Period</p>
                  <p className="text-amber-200/60 text-xs">Your platform is in trial mode. Upgrade to activate full production features and remove volume limits.</p>
                  <Button size="sm" className="mt-3 bg-amber-600 hover:bg-amber-700 text-white text-xs">
                    Upgrade Plan
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-white/80 text-sm font-medium">Tenant ID</p>
                  <div className="flex items-center gap-2">
                    <code className="bg-white/10 text-white/70 px-3 py-2 rounded-lg text-xs font-mono flex-1">{tenant.id}</code>
                    <Button size="sm" variant="ghost" className="text-white/50 hover:text-white hover:bg-white/10"
                      onClick={() => { navigator.clipboard.writeText(String(tenant.id)); toast.success("Copied!"); }}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-white/80 text-sm font-medium">Platform Slug</p>
                  <div className="flex items-center gap-2">
                    <code className="bg-white/10 text-white/70 px-3 py-2 rounded-lg text-xs font-mono flex-1">{tenant.slug}</code>
                    <Button size="sm" variant="ghost" className="text-white/50 hover:text-white hover:bg-white/10"
                      onClick={() => { navigator.clipboard.writeText(tenant.slug); toast.success("Copied!"); }}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  

    </DashboardLayout>

  );
}
