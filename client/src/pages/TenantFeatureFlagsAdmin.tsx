import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Building2, Flag, Search, RefreshCw, X, ChevronDown, ChevronRight, Users, Shield } from "lucide-react";

export default function TenantFeatureFlagsAdmin() {
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [flagSearch, setFlagSearch] = useState("");
  const [overrideDialog, setOverrideDialog] = useState<{ flagId: number; flagKey: string; current: boolean | null } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideEnabled, setOverrideEnabled] = useState(true);
  const [userOverrideDialog, setUserOverrideDialog] = useState<{ flagId: number; flagKey: string } | null>(null);
  const [userIdInput, setUserIdInput] = useState("");
  const [userOverrideEnabled, setUserOverrideEnabled] = useState(true);

  // Fetch tenants list
  const { data: tenantsData, isLoading: tenantsLoading, refetch: refetchTenants } = trpc.tenants.list.useQuery({});
  const tenants: any[] = (tenantsData as any)?.tenants ?? (Array.isArray(tenantsData) ? tenantsData : []);

  // Fetch all flags
  const { data: flagsData, isLoading: flagsLoading, refetch: refetchFlags } = trpc.featureFlags.list.useQuery({ search: flagSearch || undefined });
  const flags: any[] = (flagsData as any)?.flags ?? (Array.isArray(flagsData) ? flagsData : []);

  // Fetch tenant detail (includes overrides)
  const { data: tenantDetail, refetch: refetchTenantDetail } = trpc.tenants.get.useQuery(
    { id: selectedTenantId! },
    { enabled: !!selectedTenantId }
  );
  const tenantOverrides: any[] = (tenantDetail as any)?.overrides ?? [];

  // Mutations
  const setOverrideMutation = trpc.featureFlags.setTenantOverride.useMutation({
    onSuccess: () => {
      toast.success("Tenant override saved");
      refetchTenantDetail();
      refetchFlags();
      setOverrideDialog(null);
      setOverrideReason("");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeOverrideMutation = trpc.featureFlags.removeTenantOverride.useMutation({
    onSuccess: () => {
      toast.success("Override removed — reverted to global default");
      refetchTenantDetail();
      refetchFlags();
    },
    onError: (e) => toast.error(e.message),
  });

  const setUserOverrideMutation = trpc.featureFlags.setUserOverride.useMutation({
    onSuccess: () => {
      toast.success("User override saved");
      setUserOverrideDialog(null);
      setUserIdInput("");
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedTenant = tenants.find((t: any) => t.id === selectedTenantId);

  const getOverrideForFlag = (flagId: number) => {
    return tenantOverrides.find((o: any) => o.flagId === flagId || o.flag_id === flagId);
  };

  const handleToggleOverride = (flag: any) => {
    if (!selectedTenantId) return;
    const override = getOverrideForFlag(flag.id);
    const currentEnabled = override ? override.enabled : flag.defaultEnabled;
    setOverrideEnabled(!currentEnabled);
    setOverrideDialog({ flagId: flag.id, flagKey: flag.key ?? flag.flag_key, current: currentEnabled });
  };

  const handleRemoveOverride = (flag: any) => {
    if (!selectedTenantId) return;
    removeOverrideMutation.mutate({ tenantId: selectedTenantId, flagId: flag.id });
  };

  const handleSaveOverride = () => {
    if (!overrideDialog || !selectedTenantId) return;
    setOverrideMutation.mutate({
      tenantId: selectedTenantId,
      flagId: overrideDialog.flagId,
      enabled: overrideEnabled,
      reason: overrideReason || undefined,
    });
  };

  const handleUserOverride = () => {
    if (!userOverrideDialog || !userIdInput) return;
    const userId = parseInt(userIdInput, 10);
    if (isNaN(userId)) { toast.error("Invalid user ID"); return; }
    setUserOverrideMutation.mutate({ userId, flagId: userOverrideDialog.flagId, enabled: userOverrideEnabled });
  };

  const filteredFlags = flags.filter((f: any) => {
    const key = f.key ?? f.flag_key ?? "";
    const name = f.name ?? key;
    return !flagSearch || key.toLowerCase().includes(flagSearch.toLowerCase()) || name.toLowerCase().includes(flagSearch.toLowerCase());
  });

  const planBadgeColor: Record<string, string> = {
    starter: "bg-slate-100 text-slate-700",
    growth: "bg-blue-100 text-blue-700",
    enterprise: "bg-purple-100 text-purple-700",
    white_label: "bg-amber-100 text-amber-700",
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Flag className="w-6 h-6 text-primary" />
              Tenant Feature Flags
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage per-tenant feature flag overrides. Overrides take precedence over global defaults.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { refetchTenants(); refetchFlags(); }}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tenant List */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Tenants
                <Badge variant="secondary" className="ml-auto">{tenants.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {tenantsLoading ? (
                <div className="p-4 text-center text-muted-foreground text-sm">Loading tenants...</div>
              ) : tenants.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">No tenants found</div>
              ) : (
                <div className="divide-y max-h-[500px] overflow-y-auto">
                  {tenants.map((tenant: any) => (
                    <button
                      key={tenant.id}
                      onClick={() => setSelectedTenantId(tenant.id === selectedTenantId ? null : tenant.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center justify-between ${selectedTenantId === tenant.id ? "bg-primary/5 border-l-2 border-primary" : ""}`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{tenant.name}</div>
                        <div className="text-xs text-muted-foreground">{tenant.slug}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${planBadgeColor[tenant.plan] ?? "bg-gray-100 text-gray-700"}`}>
                          {tenant.plan}
                        </span>
                        {selectedTenantId === tenant.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Flag Overrides Panel */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Flag className="w-4 h-4" />
                  {selectedTenant ? (
                    <span>Flags for <span className="text-primary">{selectedTenant.name}</span></span>
                  ) : (
                    <span className="text-muted-foreground">Select a tenant to manage flags</span>
                  )}
                </CardTitle>
                {selectedTenant && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {tenantOverrides.length} override{tenantOverrides.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                )}
              </div>
              {selectedTenant && (
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search flags..."
                    value={flagSearch}
                    onChange={(e) => setFlagSearch(e.target.value)}
                    className="pl-9 h-8 text-sm"
                  />
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {!selectedTenant ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Select a tenant from the list to manage their feature flag overrides.</p>
                </div>
              ) : flagsLoading ? (
                <div className="p-4 text-center text-muted-foreground text-sm">Loading flags...</div>
              ) : (
                <Tabs defaultValue="all" className="w-full">
                  <TabsList className="mx-4 mt-2 mb-0 h-8">
                    <TabsTrigger value="all" className="text-xs">All Flags ({filteredFlags.length})</TabsTrigger>
                    <TabsTrigger value="overridden" className="text-xs">Overridden ({tenantOverrides.length})</TabsTrigger>
                    <TabsTrigger value="user" className="text-xs">User Overrides</TabsTrigger>
                  </TabsList>

                  <TabsContent value="all" className="mt-0">
                    <div className="divide-y max-h-[420px] overflow-y-auto">
                      {filteredFlags.map((flag: any) => {
                        const override = getOverrideForFlag(flag.id);
                        const effectiveEnabled = override ? override.enabled : (flag.defaultEnabled ?? flag.default_enabled ?? true);
                        const hasOverride = !!override;
                        return (
                          <div key={flag.id} className="px-4 py-3 flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">{flag.key ?? flag.flag_key}</span>
                                {hasOverride && (
                                  <Badge variant="outline" className="text-xs h-4 px-1 border-orange-300 text-orange-600">override</Badge>
                                )}
                              </div>
                              <div className="text-sm font-medium truncate">{flag.name ?? flag.key}</div>
                              {override?.reason && (
                                <div className="text-xs text-muted-foreground italic truncate">Reason: {override.reason}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-xs ${effectiveEnabled ? "text-green-600" : "text-red-500"}`}>
                                {effectiveEnabled ? "Enabled" : "Disabled"}
                              </span>
                              <Switch
                                checked={effectiveEnabled}
                                onCheckedChange={() => handleToggleOverride(flag)}
                                className="scale-90"
                              />
                              {hasOverride && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleRemoveOverride(flag)}
                                  title="Remove override (revert to global default)"
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {filteredFlags.length === 0 && (
                        <div className="p-6 text-center text-muted-foreground text-sm">No flags match your search.</div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="overridden" className="mt-0">
                    <div className="divide-y max-h-[420px] overflow-y-auto">
                      {tenantOverrides.length === 0 ? (
                        <div className="p-6 text-center text-muted-foreground text-sm">
                          No overrides set for this tenant. All flags use global defaults.
                        </div>
                      ) : tenantOverrides.map((override: any) => {
                        const flag = flags.find((f: any) => f.id === (override.flagId ?? override.flag_id));
                        return (
                          <div key={override.id} className="px-4 py-3 flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-xs text-muted-foreground">{flag?.key ?? flag?.flag_key ?? `Flag #${override.flagId ?? override.flag_id}`}</div>
                              <div className="text-sm font-medium">{flag?.name ?? "Unknown flag"}</div>
                              {override.reason && <div className="text-xs text-muted-foreground italic">Reason: {override.reason}</div>}
                              <div className="text-xs text-muted-foreground">
                                Set by admin · {override.updatedAt ? new Date(override.updatedAt).toLocaleDateString() : ""}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge className={override.enabled ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}>
                                {override.enabled ? "Enabled" : "Disabled"}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => removeOverrideMutation.mutate({ tenantId: selectedTenantId!, flagId: override.flagId ?? override.flag_id })}
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </TabsContent>

                  <TabsContent value="user" className="mt-0">
                    <div className="p-4 space-y-4">
                      <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                        <Users className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                          User-level overrides take the highest priority — they override both tenant and global defaults. Use for beta access, early access, or individual user restrictions.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Set User Override</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {filteredFlags.slice(0, 6).map((flag: any) => (
                            <Button
                              key={flag.id}
                              variant="outline"
                              size="sm"
                              className="justify-start text-xs h-8"
                              onClick={() => { setUserOverrideDialog({ flagId: flag.id, flagKey: flag.key ?? flag.flag_key }); setUserOverrideEnabled(true); }}
                            >
                              <Shield className="w-3 h-3 mr-1 shrink-0" />
                              <span className="truncate">{flag.key ?? flag.flag_key}</span>
                            </Button>
                          ))}
                        </div>
                        {filteredFlags.length > 6 && (
                          <p className="text-xs text-muted-foreground">Search flags above to find specific ones.</p>
                        )}
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Override Dialog */}
        <Dialog open={!!overrideDialog} onOpenChange={(o) => !o && setOverrideDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Set Tenant Override</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="p-3 bg-muted rounded-lg">
                <div className="font-mono text-xs text-muted-foreground">{overrideDialog?.flagKey}</div>
                <div className="text-sm font-medium mt-1">
                  For tenant: <span className="text-primary">{selectedTenant?.name}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label>Override value</Label>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${overrideEnabled ? "text-green-600" : "text-red-500"}`}>
                    {overrideEnabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch checked={overrideEnabled} onCheckedChange={setOverrideEnabled} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Reason (optional)</Label>
                <Textarea
                  placeholder="Why is this override being set? (e.g. 'Pilot program for Q2', 'Compliance requirement')"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={2}
                  className="text-sm"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOverrideDialog(null)}>Cancel</Button>
              <Button onClick={handleSaveOverride} disabled={setOverrideMutation.isPending}>
                {setOverrideMutation.isPending ? "Saving..." : "Save Override"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* User Override Dialog */}
        <Dialog open={!!userOverrideDialog} onOpenChange={(o) => !o && setUserOverrideDialog(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Set User Override</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="p-3 bg-muted rounded-lg">
                <div className="font-mono text-xs text-muted-foreground">{userOverrideDialog?.flagKey}</div>
              </div>
              <div className="space-y-1">
                <Label>User ID</Label>
                <Input
                  placeholder="Enter numeric user ID"
                  value={userIdInput}
                  onChange={(e) => setUserIdInput(e.target.value)}
                  type="number"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Override value</Label>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${userOverrideEnabled ? "text-green-600" : "text-red-500"}`}>
                    {userOverrideEnabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch checked={userOverrideEnabled} onCheckedChange={setUserOverrideEnabled} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUserOverrideDialog(null)}>Cancel</Button>
              <Button onClick={handleUserOverride} disabled={setUserOverrideMutation.isPending || !userIdInput}>
                {setUserOverrideMutation.isPending ? "Saving..." : "Save Override"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
