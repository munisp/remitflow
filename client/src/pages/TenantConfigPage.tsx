import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Edit, Ban, Search, Building2 } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

interface TenantFormData {
  name: string; slug: string; primaryColor: string; secondaryColor: string;
  logoUrl: string; customDomain: string; supportEmail: string; defaultCurrency: string;
}

const defaultForm: TenantFormData = {
  name: "", slug: "", primaryColor: "#7c3aed", secondaryColor: "#06b6d4",
  logoUrl: "", customDomain: "", supportEmail: "", defaultCurrency: "USD",
};

export default function TenantConfigPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [editTenant, setEditTenant] = useState<any | null>(null);
  const [form, setForm] = useState<TenantFormData>(defaultForm);
  const PAGE_SIZE = 20;

  const tenantsQuery = trpc.v89.tenantWhiteLabel.getAll.useQuery({
    search: search || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
  });

  const createMutation = trpc.v89.tenantWhiteLabel.create.useMutation({
    onSuccess: () => { toast.success("Tenant created"); setShowCreate(false); setForm(defaultForm); tenantsQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.v89.tenantWhiteLabel.update.useMutation({
    onSuccess: () => { toast.success("Tenant updated"); setEditTenant(null); tenantsQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const deactivateMutation = trpc.v89.tenantWhiteLabel.deactivate.useMutation({
    onSuccess: () => { toast.success("Tenant suspended"); tenantsQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const tenants = tenantsQuery.data?.tenants ?? [];
  const total = tenantsQuery.data?.total ?? 0;

  const handleCreate = () => {
    createMutation.mutate({
      name: form.name, slug: form.slug, primaryColor: form.primaryColor,
      secondaryColor: form.secondaryColor,
      logoUrl: form.logoUrl || undefined, customDomain: form.customDomain || undefined,
      supportEmail: form.supportEmail || undefined, defaultCurrency: form.defaultCurrency,
    });
  };

  const handleUpdate = () => {
    if (!editTenant) return;
    updateMutation.mutate({
      id: editTenant.id, name: form.name, primaryColor: form.primaryColor,
      secondaryColor: form.secondaryColor, logoUrl: form.logoUrl || undefined,
      customDomain: form.customDomain || undefined, supportEmail: form.supportEmail || undefined,
    });
  };

  const openEdit = (t: any) => {
    setEditTenant(t);
    setForm({ name: t.name, slug: t.slug, primaryColor: t.primaryColor ?? "#7c3aed",
      secondaryColor: t.secondaryColor ?? "#06b6d4", logoUrl: t.logoUrl ?? "",
      customDomain: t.customDomain ?? "", supportEmail: t.supportEmail ?? "",
      defaultCurrency: t.defaultCurrency ?? "USD" });
  };

  const STATUS_COLORS: Record<string, string> = {
    active: "bg-green-500/20 text-green-400",
    trial: "bg-yellow-500/20 text-yellow-400",
    suspended: "bg-red-500/20 text-red-400",
    inactive: "bg-gray-500/20 text-gray-400",
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tenant White-Label Config</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage multi-tenant branding and configuration</p>
        </div>
        <Button onClick={() => { setForm(defaultForm); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-2" /> New Tenant
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search tenants..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {tenantsQuery.isPending ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-card border-border animate-pulse h-40" />
          ))
        ) : tenants.length === 0 ? (
          <div className="col-span-3 text-center py-16 text-muted-foreground">
            <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No tenants found</p>
          </div>
        ) : tenants.map((t: any) => (
          <Card key={t.id} className="bg-card border-border hover:border-primary/50 transition-colors">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: t.primaryColor ?? "#7c3aed" }}>
                    {t.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    <p className="text-xs text-muted-foreground font-mono">{t.slug}</p>
                  </div>
                </div>
                <Badge className={STATUS_COLORS[t.status ?? "active"] ?? "bg-gray-500/20 text-gray-400"}>
                  {t.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <div className="w-5 h-5 rounded" style={{ backgroundColor: t.primaryColor ?? "#7c3aed" }} title="Primary" />
                <div className="w-5 h-5 rounded" style={{ backgroundColor: t.secondaryColor ?? "#06b6d4" }} title="Secondary" />
              </div>
              {t.customDomain && <p className="text-xs text-muted-foreground">🌐 {t.customDomain}</p>}
              <p className="text-xs text-muted-foreground">💱 {t.defaultCurrency}</p>
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => openEdit(t)}>
                  <Edit className="w-3 h-3 mr-1" /> Edit
                </Button>
                {t.status !== "suspended" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-400 border-red-500/30"
                    onClick={() => deactivateMutation.mutate({ id: t.id })}>
                    <Ban className="w-3 h-3 mr-1" /> Suspend
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Showing {Math.min(total, PAGE_SIZE)} of {total} tenants</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create New Tenant</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Acme Corp" />
              </div>
              <div className="space-y-1">
                <Label>Slug *</Label>
                <Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))} placeholder="acme-corp" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Primary Color</Label>
                <div className="flex gap-2">
                  <input type="color" value={form.primaryColor} onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))} className="w-10 h-9 rounded border border-border cursor-pointer" />
                  <Input value={form.primaryColor} onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Secondary Color</Label>
                <div className="flex gap-2">
                  <input type="color" value={form.secondaryColor} onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))} className="w-10 h-9 rounded border border-border cursor-pointer" />
                  <Input value={form.secondaryColor} onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Custom Domain</Label>
              <Input value={form.customDomain} onChange={(e) => setForm((f) => ({ ...f, customDomain: e.target.value }))} placeholder="app.acmecorp.com" />
            </div>
            <div className="space-y-1">
              <Label>Support Email</Label>
              <Input type="email" value={form.supportEmail} onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))} placeholder="support@acmecorp.com" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending || !form.name || !form.slug}>
              {createMutation.isPending ? "Creating..." : "Create Tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTenant} onOpenChange={(open) => !open && setEditTenant(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Tenant: {editTenant?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Primary Color</Label>
                <div className="flex gap-2">
                  <input type="color" value={form.primaryColor} onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))} className="w-10 h-9 rounded border border-border cursor-pointer" />
                  <Input value={form.primaryColor} onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Secondary Color</Label>
                <div className="flex gap-2">
                  <input type="color" value={form.secondaryColor} onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))} className="w-10 h-9 rounded border border-border cursor-pointer" />
                  <Input value={form.secondaryColor} onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Custom Domain</Label>
              <Input value={form.customDomain} onChange={(e) => setForm((f) => ({ ...f, customDomain: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Support Email</Label>
              <Input type="email" value={form.supportEmail} onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTenant(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  

    </DashboardLayout>

  );
}
