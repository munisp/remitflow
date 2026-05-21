import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {  Plus, Copy, Power, PowerOff, Trash2, RefreshCw, Building2,
  Key, Users, Globe, CheckCircle2, XCircle, Clock, Search,
  BarChart3, TrendingUp, Activity, Shield,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function AdminInviteCodes() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("codes");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tenantStatusFilter, setTenantStatusFilter] = useState<string>("all");
  const [newCode, setNewCode] = useState<{ description: string; plan: "starter" | "growth" | "enterprise"; maxUses: number; expiresInDays?: number; customCode?: string }>({
    description: "", plan: "starter", maxUses: 1,
  });
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  const { data: codesData, refetch: refetchCodes, isLoading: codesLoading } = trpc.adminInviteCodes.list.useQuery({
    page: 1, limit: 50, activeOnly: false,
  });

  const { data: tenantsData, refetch: refetchTenants } = trpc.adminInviteCodes.listTenants.useQuery({
    page: 1, limit: 50, status: tenantStatusFilter === "all" ? undefined : tenantStatusFilter as any,
  });

  const { data: sessionsData } = trpc.adminInviteCodes.listOnboardingSessions.useQuery({
    page: 1, limit: 20,
  });

  const generateMutation = trpc.adminInviteCodes.generate.useMutation({
    onSuccess: (result) => {
      toast.success(`Code generated: ${result.code}`);
      setGeneratedCode(result.code);
      refetchCodes();
    },
    onError: (e) => toast.error(e.message),
  });

  const deactivateMutation = trpc.adminInviteCodes.deactivate.useMutation({
    onSuccess: () => { toast.success("Code deactivated"); refetchCodes(); },
    onError: (e) => toast.error(e.message),
  });

  const reactivateMutation = trpc.adminInviteCodes.reactivate.useMutation({
    onSuccess: () => { toast.success("Code reactivated"); refetchCodes(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.adminInviteCodes.delete.useMutation({
    onSuccess: () => { toast.success("Code deleted"); refetchCodes(); },
    onError: (e) => toast.error(e.message),
  });

  const updateTenantStatusMutation = trpc.adminInviteCodes.updateTenantStatus.useMutation({
    onSuccess: () => { toast.success("Tenant status updated"); refetchTenants(); },
    onError: (e) => toast.error(e.message),
  });

  const codes = codesData?.codes ?? [];
  const tenants = tenantsData?.tenants ?? [];
  const sessions = sessionsData?.sessions ?? [];

  const filteredCodes = codes.filter((c: any) =>
    !searchQuery || c.code.includes(searchQuery.toUpperCase()) || c.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const planBadge: Record<string, string> = {
    starter: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    growth: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    enterprise: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  };

  const statusBadge: Record<string, string> = {
    trial: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    active: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    suspended: "bg-red-500/20 text-red-300 border-red-500/30",
    cancelled: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Partner Management</h1>
          <p className="text-white/50 text-sm mt-1">Manage invite codes, white-label tenants, and onboarding sessions</p>
        </div>
        <Dialog open={generateOpen} onOpenChange={(o) => { setGenerateOpen(o); if (!o) setGeneratedCode(null); }}>
          <DialogTrigger asChild>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
              <Plus className="w-4 h-4" /> Generate Invite Code
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white">Generate Partner Invite Code</DialogTitle>
              <DialogDescription className="text-white/50">
                Create a unique invite code for a new white-label partner
              </DialogDescription>
            </DialogHeader>
            {generatedCode ? (
              <div className="space-y-4 py-2">
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-5 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                  <p className="text-white font-bold text-xl font-mono tracking-widest mb-1">{generatedCode}</p>
                  <p className="text-white/50 text-xs">Invite code generated successfully</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" className="border-white/20 text-white/70 hover:bg-white/10"
                    onClick={() => { navigator.clipboard.writeText(generatedCode); toast.success("Code copied!"); }}>
                    <Copy className="w-4 h-4 mr-2" /> Copy Code
                  </Button>
                  <Button variant="outline" className="border-white/20 text-white/70 hover:bg-white/10"
                    onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/partner/onboard?code=${generatedCode}`); toast.success("Link copied!"); }}>
                    <Globe className="w-4 h-4 mr-2" /> Copy Link
                  </Button>
                </div>
                <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => { setGenerateOpen(false); setGeneratedCode(null); }}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label className="text-white/80 text-sm">Plan *</Label>
                  <Select value={newCode.plan} onValueChange={v => setNewCode(p => ({ ...p, plan: v as "starter" | "growth" | "enterprise" }))}>
                    <SelectTrigger className="bg-white/10 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter — up to 100 users, $50K/mo</SelectItem>
                      <SelectItem value="growth">Growth — up to 1,000 users, $500K/mo</SelectItem>
                      <SelectItem value="enterprise">Enterprise — unlimited</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80 text-sm">Description (internal note)</Label>
                  <Textarea value={newCode.description} onChange={e => setNewCode(p => ({ ...p, description: e.target.value }))}
                    placeholder="e.g. For Acme Financial Ltd - Lagos expansion partner"
                    rows={2} className="bg-white/10 border-white/20 text-white placeholder:text-white/30 resize-none text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-white/80 text-sm">Max Uses</Label>
                    <Input type="number" min="1" max="1000" value={newCode.maxUses}
                      onChange={e => setNewCode(p => ({ ...p, maxUses: parseInt(e.target.value) }))}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80 text-sm">Expires in (days)</Label>
                    <Input type="number" min="1" max="365" value={newCode.expiresInDays ?? ""}
                      onChange={e => setNewCode(p => ({ ...p, expiresInDays: e.target.value ? parseInt(e.target.value) : undefined }))}
                      placeholder="Never" className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80 text-sm">Custom Code (optional)</Label>
                  <Input value={newCode.customCode ?? ""} onChange={e => setNewCode(p => ({ ...p, customCode: e.target.value.toUpperCase() }))}
                    placeholder="Leave blank to auto-generate" className="bg-white/10 border-white/20 text-white placeholder:text-white/30 font-mono" />
                </div>
                <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={generateMutation.isPending}
                  onClick={() => generateMutation.mutate(newCode)}>
                  {generateMutation.isPending ? "Generating..." : "Generate Code"}
                  <Key className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Codes", value: codesData?.total ?? 0, icon: Key, color: "violet" },
          { label: "Active Tenants", value: tenants.filter((t: any) => t.status === "active").length, icon: Building2, color: "emerald" },
          { label: "In Progress", value: sessions.filter((s: any) => s.status === "in_progress").length, icon: Activity, color: "amber" },
          { label: "Completed", value: sessions.filter((s: any) => s.status === "completed").length, icon: CheckCircle2, color: "blue" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-white/5 border-white/10">
            <CardContent className="pt-4 pb-3">
              <div className={`w-7 h-7 rounded-lg bg-${color}-500/20 flex items-center justify-center mb-2`}>
                <Icon className={`w-3.5 h-3.5 text-${color}-400`} />
              </div>
              <p className="text-xl font-bold text-white">{value}</p>
              <p className="text-white/50 text-xs">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="codes" className="text-white/60 data-[state=active]:text-white data-[state=active]:bg-white/10 gap-1.5 text-xs">
            <Key className="w-3.5 h-3.5" /> Invite Codes ({codesData?.total ?? 0})
          </TabsTrigger>
          <TabsTrigger value="tenants" className="text-white/60 data-[state=active]:text-white data-[state=active]:bg-white/10 gap-1.5 text-xs">
            <Building2 className="w-3.5 h-3.5" /> Tenants ({tenantsData?.total ?? 0})
          </TabsTrigger>
          <TabsTrigger value="sessions" className="text-white/60 data-[state=active]:text-white data-[state=active]:bg-white/10 gap-1.5 text-xs">
            <Activity className="w-3.5 h-3.5" /> Onboarding Sessions
          </TabsTrigger>
        </TabsList>

        {/* ── Invite Codes Tab ─────────────────────────────────────────────── */}
        <TabsContent value="codes" className="space-y-4 mt-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search codes or descriptions..." className="pl-9 bg-white/10 border-white/20 text-white placeholder:text-white/30 h-9 text-sm" />
            </div>
            <Button size="sm" variant="ghost" className="text-white/50 hover:text-white hover:bg-white/10"
              onClick={() => refetchCodes()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {codesLoading && <p className="text-white/30 text-sm text-center py-8">Loading...</p>}
            {!codesLoading && filteredCodes.length === 0 && (
              <div className="text-center py-10">
                <Key className="w-10 h-10 text-white/20 mx-auto mb-3" />
                <p className="text-white/30 text-sm">No invite codes yet</p>
                <p className="text-white/20 text-xs mt-1">Generate your first code to start onboarding partners</p>
              </div>
            )}
            {filteredCodes.map((code: any) => {
              const isExpired = code.expiresAt && new Date() > new Date(code.expiresAt);
              const isExhausted = code.maxUses !== null && code.usedCount >= (code.maxUses ?? 0);
              const usagePercent = code.maxUses ? Math.round((code.usedCount / code.maxUses) * 100) : 0;

              return (
                <div key={code.id} className={`flex items-center justify-between p-4 rounded-xl border ${
                  !code.isActive || isExpired ? "bg-white/3 border-white/5 opacity-60" : "bg-white/5 border-white/10"
                }`}>
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${code.isActive && !isExpired && !isExhausted ? "bg-emerald-400" : "bg-red-400"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-white font-mono font-bold text-sm tracking-wider">{code.code}</code>
                        <Badge className={`text-xs capitalize ${planBadge[code.plan] ?? ""}`}>{code.plan}</Badge>
                        {isExpired && <Badge className="text-xs bg-red-500/20 text-red-300 border-red-500/30">Expired</Badge>}
                        {isExhausted && <Badge className="text-xs bg-gray-500/20 text-gray-300 border-gray-500/30">Exhausted</Badge>}
                      </div>
                      {code.description && <p className="text-white/40 text-xs mt-0.5 truncate">{code.description}</p>}
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-white/30 text-xs">
                          {code.usedCount}/{code.maxUses ?? "∞"} uses
                        </span>
                        {code.expiresAt && (
                          <span className="text-white/30 text-xs flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {isExpired ? "Expired" : `Expires ${new Date(code.expiresAt).toLocaleDateString()}`}
                          </span>
                        )}
                        <span className="text-white/30 text-xs">by {code.creatorName}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-4">
                    <Button size="sm" variant="ghost" className="text-white/50 hover:text-white hover:bg-white/10 h-7 w-7 p-0"
                      onClick={() => { navigator.clipboard.writeText(code.code); toast.success("Code copied!"); }}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-white/50 hover:text-white hover:bg-white/10 h-7 w-7 p-0"
                      onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/partner/onboard?code=${code.code}`); toast.success("Link copied!"); }}>
                      <Globe className="w-3.5 h-3.5" />
                    </Button>
                    {code.isActive ? (
                      <Button size="sm" variant="ghost" className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 h-7 w-7 p-0"
                        onClick={() => deactivateMutation.mutate({ id: code.id })}>
                        <PowerOff className="w-3.5 h-3.5" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 h-7 w-7 p-0"
                        onClick={() => reactivateMutation.mutate({ id: code.id })}>
                        <Power className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 w-7 p-0"
                      onClick={() => { if (confirm("Delete this invite code?")) deleteMutation.mutate({ id: code.id }); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ── Tenants Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="tenants" className="space-y-4 mt-4">
          <div className="flex items-center gap-3">
            <Select value={tenantStatusFilter} onValueChange={setTenantStatusFilter}>
              <SelectTrigger className="bg-white/10 border-white/20 text-white w-40 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="trial">Trial</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="text-white/50 hover:text-white hover:bg-white/10"
              onClick={() => refetchTenants()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {tenants.length === 0 && (
              <div className="text-center py-10">
                <Building2 className="w-10 h-10 text-white/20 mx-auto mb-3" />
                <p className="text-white/30 text-sm">No tenants yet</p>
              </div>
            )}
            {tenants.map((tenant: any) => (
              <div key={tenant.id} className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{ background: tenant.primaryColor ?? "#7c3aed" }}>
                    {tenant.brandName?.charAt(0) ?? "T"}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-medium text-sm">{tenant.brandName}</p>
                      <Badge className={`text-xs capitalize ${statusBadge[tenant.status ?? "trial"] ?? ""}`}>{tenant.status}</Badge>
                      <Badge className={`text-xs capitalize ${planBadge[tenant.plan ?? "starter"] ?? ""}`}>{tenant.plan}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-white/40 text-xs">/{tenant.slug}</span>
                      {tenant.customDomain && <span className="text-white/40 text-xs">{tenant.customDomain}</span>}
                      <span className="text-white/40 text-xs">{tenant.ownerEmail}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <span className="text-white/30 text-xs hidden md:block">{new Date(tenant.createdAt).toLocaleDateString()}</span>
                  <Select value={tenant.status ?? "trial"}
                    onValueChange={v => updateTenantStatusMutation.mutate({ tenantId: tenant.id, status: v as any })}>
                    <SelectTrigger className="bg-white/10 border-white/20 text-white w-28 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trial">Trial</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ── Sessions Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="sessions" className="space-y-4 mt-4">
          <div className="space-y-2">
            {sessions.length === 0 && (
              <div className="text-center py-10">
                <Activity className="w-10 h-10 text-white/20 mx-auto mb-3" />
                <p className="text-white/30 text-sm">No onboarding sessions yet</p>
              </div>
            )}
            {sessions.map((session: any) => {
              const isExpired = new Date() > new Date(session.expiresAt);
              const statusColors: Record<string, string> = {
                in_progress: isExpired ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30",
                completed: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
                abandoned: "bg-gray-500/20 text-gray-300 border-gray-500/30",
              };

              return (

                <DashboardLayout>
                <div key={session.id} className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-white/80 font-mono text-xs">{session.inviteCode}</code>
                        <Badge className={`text-xs capitalize ${planBadge[session.plan] ?? ""}`}>{session.plan}</Badge>
                        <Badge className={`text-xs ${statusColors[session.status] ?? ""}`}>
                          {session.status === "in_progress" && isExpired ? "expired" : session.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {session.userEmail && <span className="text-white/40 text-xs">{session.userEmail}</span>}
                        {session.tenantName && <span className="text-white/40 text-xs">→ {session.tenantName}</span>}
                        <span className="text-white/30 text-xs">Step {session.step}/6</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <div className="text-right hidden md:block">
                      <p className="text-white/40 text-xs">{new Date(session.createdAt).toLocaleDateString()}</p>
                      {session.completedAt && <p className="text-emerald-400 text-xs">Completed {new Date(session.completedAt).toLocaleDateString()}</p>}
                    </div>
                    {session.status === "completed" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : isExpired ? (
                      <XCircle className="w-4 h-4 text-red-400" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-400" />
                    )}
                  </div>
                </div>
              

                </DashboardLayout>

              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
