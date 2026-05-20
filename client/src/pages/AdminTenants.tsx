import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Building2, Plus, Search, MoreHorizontal, CheckCircle, XCircle, Clock, AlertTriangle, Users, Globe, Settings, Palette, Flag } from "lucide-react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  active:    { label: "Active",    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",   icon: <CheckCircle className="h-3 w-3" /> },
  trial:     { label: "Trial",     color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",       icon: <Clock className="h-3 w-3" /> },
  suspended: { label: "Suspended", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",           icon: <XCircle className="h-3 w-3" /> },
  churned:   { label: "Churned",   color: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",       icon: <AlertTriangle className="h-3 w-3" /> },
};

const PLAN_CONFIG: Record<string, { label: string; color: string }> = {
  starter:     { label: "Starter",     color: "bg-slate-100 text-slate-700" },
  growth:      { label: "Growth",      color: "bg-blue-100 text-blue-700" },
  enterprise:  { label: "Enterprise",  color: "bg-purple-100 text-purple-700" },
  white_label: { label: "White Label", color: "bg-amber-100 text-amber-700" },
};

function CreateTenantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    slug: "", name: "", plan: "starter" as const, brandName: "",
    primaryColor: "#7c3aed", defaultCurrency: "USD", defaultLocale: "en",
    supportEmail: "", maxUsers: 100,
  });

  const create = trpc.tenants.create.useMutation({
    onSuccess: () => { toast.success("Tenant created"); utils.tenants.list.invalidate(); utils.tenants.stats.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Create New Tenant</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tenant Name *</Label>
              <Input placeholder="Acme Remittance" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))} />
            </div>
            <div className="space-y-1">
              <Label>Slug (URL) *</Label>
              <Input placeholder="acme-remittance" value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Plan</Label>
              <Select value={form.plan} onValueChange={v => setForm(f => ({ ...f, plan: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="growth">Growth</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                  <SelectItem value="white_label">White Label</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Brand Name</Label>
              <Input placeholder="Acme Pay" value={form.brandName}
                onChange={e => setForm(f => ({ ...f, brandName: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Default Currency</Label>
              <Select value={form.defaultCurrency} onValueChange={v => setForm(f => ({ ...f, defaultCurrency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["USD","GBP","EUR","NGN","KES","GHS","ZAR","CAD","AUD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Primary Color</Label>
              <div className="flex gap-2">
                <input type="color" value={form.primaryColor} onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))} className="h-9 w-12 rounded border cursor-pointer" />
                <Input value={form.primaryColor} onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))} className="font-mono" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Support Email</Label>
              <Input type="email" placeholder="support@acme.com" value={form.supportEmail}
                onChange={e => setForm(f => ({ ...f, supportEmail: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Max Users</Label>
              <Input type="number" min={1} value={form.maxUsers}
                onChange={e => setForm(f => ({ ...f, maxUsers: Number(e.target.value) }))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate({ ...form, supportEmail: form.supportEmail || undefined })} disabled={create.isPending || !form.slug || !form.name}>
            {create.isPending ? "Creating…" : "Create Tenant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TenantDetailDialog({ tenantId, open, onClose }: { tenantId: number; open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.tenants.get.useQuery({ id: tenantId }, { enabled: open });
  const [tab, setTab] = useState("overview");

  const update = trpc.tenants.update.useMutation({
    onSuccess: () => { toast.success("Tenant updated"); utils.tenants.get.invalidate({ id: tenantId }); utils.tenants.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const suspend = trpc.tenants.suspend.useMutation({
    onSuccess: () => { toast.success("Tenant suspended"); utils.tenants.get.invalidate({ id: tenantId }); utils.tenants.list.invalidate(); onClose(); },
  });

  const activate = trpc.tenants.activate.useMutation({
    onSuccess: () => { toast.success("Tenant activated"); utils.tenants.get.invalidate({ id: tenantId }); utils.tenants.list.invalidate(); onClose(); },
  });

  if (!data && !isLoading) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {isLoading ? "Loading…" : data?.name}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}</div>
        ) : data ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="overview" className="flex-1"><Globe className="h-3.5 w-3.5 mr-1" />Overview</TabsTrigger>
              <TabsTrigger value="branding" className="flex-1"><Palette className="h-3.5 w-3.5 mr-1" />Branding</TabsTrigger>
              <TabsTrigger value="settings" className="flex-1"><Settings className="h-3.5 w-3.5 mr-1" />Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 mt-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Status", value: <Badge className={`${STATUS_CONFIG[data.status]?.color} gap-1`}>{STATUS_CONFIG[data.status]?.icon}{STATUS_CONFIG[data.status]?.label}</Badge> },
                  { label: "Plan", value: <Badge className={PLAN_CONFIG[data.plan]?.color}>{PLAN_CONFIG[data.plan]?.label}</Badge> },
                  { label: "Members", value: <span className="font-semibold">{data.memberCount}</span> },
                  { label: "Flag Overrides", value: <span className="font-semibold">{data.flagOverrides}</span> },
                  { label: "Currency", value: <span className="font-mono">{data.defaultCurrency}</span> },
                  { label: "Locale", value: <span className="font-mono">{data.defaultLocale}</span> },
                ].map(item => (
                  <div key={item.label} className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                    {item.value}
                  </div>
                ))}
              </div>
              {data.customDomain && (
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Custom Domain</p>
                  <a href={`https://${data.customDomain}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono text-sm">{data.customDomain}</a>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                {data.status !== "active" && (
                  <Button size="sm" onClick={() => activate.mutate({ id: data.id })} disabled={activate.isPending}>
                    <CheckCircle className="h-4 w-4 mr-1" /> Activate
                  </Button>
                )}
                {data.status === "active" && (
                  <Button size="sm" variant="destructive" onClick={() => suspend.mutate({ id: data.id })} disabled={suspend.isPending}>
                    <XCircle className="h-4 w-4 mr-1" /> Suspend
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => update.mutate({ id: data.id, plan: data.plan === "starter" ? "growth" : "enterprise" })}>
                  Upgrade Plan
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="branding" className="space-y-4 mt-4">
              <BrandingForm tenant={data} onSave={(vals) => update.mutate({ id: data.id, ...vals })} saving={update.isPending} />
            </TabsContent>

            <TabsContent value="settings" className="space-y-4 mt-4">
              <div className="space-y-3">
                {[
                  { label: "Max Users", key: "maxUsers", type: "number", value: data.maxUsers },
                  { label: "Support Email", key: "supportEmail", type: "email", value: data.supportEmail ?? "" },
                  { label: "Custom Domain", key: "customDomain", type: "text", value: data.customDomain ?? "" },
                ].map(field => (
                  <div key={field.key} className="space-y-1">
                    <Label>{field.label}</Label>
                    <Input type={field.type} defaultValue={field.value}
                      onBlur={e => update.mutate({ id: data.id, [field.key]: field.type === "number" ? Number(e.target.value) : e.target.value || undefined })} />
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BrandingForm({ tenant, onSave, saving }: { tenant: any; onSave: (v: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    brandName: tenant.brandName ?? "",
    logoUrl: tenant.logoUrl ?? "",
    primaryColor: tenant.primaryColor ?? "#7c3aed",
    secondaryColor: tenant.secondaryColor ?? "#06b6d4",
    accentColor: tenant.accentColor ?? "#f59e0b",
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Brand Name</Label>
        <Input value={form.brandName} onChange={e => setForm(f => ({ ...f, brandName: e.target.value }))} placeholder="Acme Pay" />
      </div>
      <div className="space-y-1">
        <Label>Logo URL</Label>
        <Input value={form.logoUrl} onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://cdn.example.com/logo.png" />
        {form.logoUrl && <img src={form.logoUrl} alt="Logo preview" className="h-10 mt-2 object-contain" onError={e => (e.currentTarget.style.display = "none")} />}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Primary", key: "primaryColor" },
          { label: "Secondary", key: "secondaryColor" },
          { label: "Accent", key: "accentColor" },
        ].map(c => (
          <div key={c.key} className="space-y-1">
            <Label>{c.label}</Label>
            <div className="flex gap-2">
              <input type="color" value={(form as any)[c.key]} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))} className="h-9 w-12 rounded border cursor-pointer" />
              <Input value={(form as any)[c.key]} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))} className="font-mono text-xs" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 p-3 rounded-lg border" style={{ backgroundColor: form.primaryColor + "20", borderColor: form.primaryColor + "40" }}>
        <div className="h-8 w-8 rounded-full" style={{ backgroundColor: form.primaryColor }} />
        <div>
          <p className="text-sm font-medium" style={{ color: form.primaryColor }}>{form.brandName || "Brand Preview"}</p>
          <p className="text-xs text-muted-foreground">Color preview</p>
        </div>
      </div>
      <Button onClick={() => onSave(form)} disabled={saving} className="w-full">
        {saving ? "Saving…" : "Save Branding"}
      </Button>
    </div>
  );
}

export default function AdminTenants() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.tenants.list.useQuery(
    { search: search || undefined, status: statusFilter !== "all" ? statusFilter as any : undefined, plan: planFilter !== "all" ? planFilter as any : undefined, limit: 50 },
    { refetchInterval: 30000 }
  );
  const { data: stats } = trpc.tenants.stats.useQuery();

  const tenants: any[] = (data as any)?.tenants ?? [];

  const deleteTenant = trpc.tenants.delete.useMutation({
    onSuccess: () => { toast.success("Tenant deleted"); utils.tenants.list.invalidate(); utils.tenants.stats.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6 text-primary" /> Tenants</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage white-label tenants, plans, and branding configurations.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Tenant</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Tenants", value: stats?.total ?? 0, icon: <Building2 className="h-4 w-4 text-primary" /> },
          { label: "Active", value: stats?.active ?? 0, icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
          { label: "Trial", value: stats?.trial ?? 0, icon: <Clock className="h-4 w-4 text-blue-500" /> },
          { label: "Enterprise", value: stats?.enterprise ?? 0, icon: <Flag className="h-4 w-4 text-purple-500" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">{s.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search tenants…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="churned">Churned</SelectItem>
          </SelectContent>
        </Select>
        <Select value={planFilter} onValueChange={setPlanFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Plan" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Plans</SelectItem>
            <SelectItem value="starter">Starter</SelectItem>
            <SelectItem value="growth">Growth</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
            <SelectItem value="white_label">White Label</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(8)].map((_, j) => <TableCell key={j}><div className="h-4 bg-muted rounded animate-pulse" /></TableCell>)}
                  </TableRow>
                ))
              ) : tenants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    <Building2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No tenants found. Create your first tenant to get started.
                  </TableCell>
                </TableRow>
              ) : (
                tenants.map((t: any) => (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedTenantId(t.id)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {t.logoUrl ? (
                          <img src={t.logoUrl} alt="" className="h-7 w-7 rounded object-contain" />
                        ) : (
                          <div className="h-7 w-7 rounded flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: t.primaryColor ?? "#7c3aed" }}>
                            {(t.brandName ?? t.name).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-sm">{t.brandName ?? t.name}</p>
                          {t.brandName && <p className="text-xs text-muted-foreground">{t.name}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{t.slug}</code></TableCell>
                    <TableCell><Badge className={`text-xs ${PLAN_CONFIG[t.plan]?.color}`}>{PLAN_CONFIG[t.plan]?.label}</Badge></TableCell>
                    <TableCell>
                      <Badge className={`text-xs gap-1 ${STATUS_CONFIG[t.status]?.color}`}>
                        {STATUS_CONFIG[t.status]?.icon}{STATUS_CONFIG[t.status]?.label}
                      </Badge>
                    </TableCell>
                    <TableCell><span className="flex items-center gap-1"><Users className="h-3.5 w-3.5 text-muted-foreground" />{t.maxUsers}</span></TableCell>
                    <TableCell><span className="font-mono text-xs">{t.defaultCurrency}</span></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSelectedTenantId(t.id)}><Settings className="h-4 w-4 mr-2" />Manage</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm(`Delete tenant "${t.name}"?`)) deleteTenant.mutate({ id: t.id }); }}>
                            <XCircle className="h-4 w-4 mr-2" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {createOpen && <CreateTenantDialog open={createOpen} onClose={() => setCreateOpen(false)} />}
      {selectedTenantId && <TenantDetailDialog tenantId={selectedTenantId} open={!!selectedTenantId} onClose={() => setSelectedTenantId(null)} />}
    </div>
  

    </DashboardLayout>

  );
}
