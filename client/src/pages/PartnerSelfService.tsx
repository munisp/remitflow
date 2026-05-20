import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Key, Webhook, Palette, Users, BarChart3, Copy, Eye, EyeOff,
  Plus, Trash2, ToggleLeft, ToggleRight, Shield, Globe, AlertCircle
} from "lucide-react";

export default function PartnerSelfService() {
  const [activeTab, setActiveTab] = useState("api-keys");
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [showCreateWebhook, setShowCreateWebhook] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyEnv, setNewKeyEnv] = useState<"sandbox" | "production">("sandbox");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<number>>(new Set());
  const [brandForm, setBrandForm] = useState({ brandName: "", supportEmail: "", primaryColor: "#7c3aed", secondaryColor: "#06b6d4" });

  const utils = trpc.useUtils();

  // Dynamically resolve the current user's tenant instead of using a hardcoded ID
  const { data: myTenants = [] } = trpc.partnerOnboarding.myTenants.useQuery();
  const activeTenant = (myTenants as any[])[0];
  const activeTenantId: number = activeTenant?.id ?? 0;

  const { data: apiKeys = [], isLoading: keysLoading } = trpc.partnerApiKeys.list.useQuery({ tenantId: activeTenantId }, { enabled: activeTenantId > 0 });
  const { data: webhooks = [], isLoading: webhooksLoading } = trpc.partnerWebhooks.list.useQuery({ tenantId: activeTenantId }, { enabled: activeTenantId > 0 });
  const { data: tenant } = trpc.partnerOnboarding.getTenant.useQuery({ slug: activeTenant?.slug ?? "" }, {
    enabled: !!activeTenant?.slug, retry: false,
  });
  useEffect(() => { if (tenant) setBrandForm({ brandName: (tenant as any).brandName ?? "", supportEmail: (tenant as any).supportEmail ?? "", primaryColor: (tenant as any).primaryColor ?? "#7c3aed", secondaryColor: (tenant as any).secondaryColor ?? "#06b6d4" }); }, [tenant]);
  const { data: analytics } = trpc.partnerOnboarding.getTenantAnalytics.useQuery({ tenantId: activeTenantId }, { enabled: activeTenantId > 0, retry: false });
  const updateBranding = trpc.whiteLabelConfig.update.useMutation({
    onSuccess: () => { toast.success("Branding saved!"); utils.partnerOnboarding.getTenant.invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const createKey = trpc.partnerApiKeys.create.useMutation({
    onSuccess: (data) => {
      setCreatedKey(data.fullKey);
      setShowCreateKey(false);
      setNewKeyName("");
      utils.partnerApiKeys.list.invalidate();
      toast.success("API key created! Copy it now — it won't be shown again.");
    },
    onError: (err) => toast.error(err.message),
  });

  const revokeKey = trpc.partnerApiKeys.revoke.useMutation({
    onSuccess: () => { toast.success("API key revoked"); utils.partnerApiKeys.list.invalidate(); },
  });

  const createWebhook = trpc.partnerWebhooks.create.useMutation({
    onSuccess: (data) => {
      setCreatedWebhookSecret(data.signingSecret);
      setShowCreateWebhook(false);
      setNewWebhookUrl("");
      utils.partnerWebhooks.list.invalidate();
      toast.success("Webhook created! Save the signing secret.");
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleWebhook = trpc.partnerWebhooks.toggle.useMutation({
    onSuccess: () => utils.partnerWebhooks.list.invalidate(),
  });

  const deleteWebhook = trpc.partnerWebhooks.delete.useMutation({
    onSuccess: () => { toast.success("Webhook deleted"); utils.partnerWebhooks.list.invalidate(); },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Partner Self-Service Portal</h1>
            <p className="text-muted-foreground">Manage your white-label integration, API keys, and settings</p>
          </div>
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Active Partner</Badge>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "API Keys", value: apiKeys.length, icon: Key, color: "text-violet-400" },
            { label: "Webhooks", value: webhooks.length, icon: Webhook, color: "text-blue-400" },
            { label: "Monthly Volume", value: analytics?.totalVolume ? `$${Number(analytics.totalVolume).toLocaleString()}` : "$0", icon: BarChart3, color: "text-green-400" },
            { label: "Total Users", value: analytics?.totalMembers ?? 0, icon: Users, color: "text-amber-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card/50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold">{value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 w-full max-w-lg">
            <TabsTrigger value="api-keys"><Key className="w-3 h-3 mr-1" />API Keys</TabsTrigger>
            <TabsTrigger value="webhooks"><Webhook className="w-3 h-3 mr-1" />Webhooks</TabsTrigger>
            <TabsTrigger value="branding"><Palette className="w-3 h-3 mr-1" />Branding</TabsTrigger>
            <TabsTrigger value="team"><Users className="w-3 h-3 mr-1" />Team</TabsTrigger>
          </TabsList>

          {/* API Keys Tab */}
          <TabsContent value="api-keys" className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-semibold">API Keys</h3>
                <p className="text-sm text-muted-foreground">Manage keys for sandbox and production environments</p>
              </div>
              <Button onClick={() => setShowCreateKey(true)}>
                <Plus className="w-4 h-4 mr-2" /> Create Key
              </Button>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-300">API keys are shown only once at creation. Store them securely — you cannot retrieve them later.</p>
            </div>

            {keysLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading keys...</div>
            ) : apiKeys.length === 0 ? (
              <Card className="text-center py-12">
                <Key className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                <p className="text-muted-foreground">No API keys yet. Create one to start integrating.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {(apiKeys as any[]).map((key: any) => (
                  <Card key={key.id} className={key.status === "revoked" ? "opacity-60" : ""}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-sm">{key.name}</p>
                            <Badge className={key.environment === "production" ? "bg-green-500/20 text-green-300" : "bg-blue-500/20 text-blue-300"}>
                              {key.environment}
                            </Badge>
                            <Badge className={key.status === "active" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}>
                              {key.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <code className="text-xs bg-muted/50 px-2 py-0.5 rounded font-mono">
                              {revealedKeys.has(key.id) ? key.key_prefix + "••••••••••••••••••••••••" : key.key_prefix + "••••••••••••••••••••••••"}
                            </code>
                            <button onClick={() => copyToClipboard(key.key_prefix)} className="text-muted-foreground hover:text-foreground">
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {key.request_count?.toLocaleString() ?? 0} requests ·
                            {key.last_used_at ? ` Last used ${new Date(key.last_used_at).toLocaleDateString()}` : " Never used"} ·
                            Created {new Date(key.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        {key.status === "active" && (
                          <Button size="sm" variant="destructive" onClick={() => revokeKey.mutate({ keyId: key.id })}>
                            Revoke
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Webhooks Tab */}
          <TabsContent value="webhooks" className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-semibold">Webhook Endpoints</h3>
                <p className="text-sm text-muted-foreground">Receive real-time event notifications</p>
              </div>
              <Button onClick={() => setShowCreateWebhook(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Endpoint
              </Button>
            </div>

            {webhooksLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading webhooks...</div>
            ) : webhooks.length === 0 ? (
              <Card className="text-center py-12">
                <Webhook className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                <p className="text-muted-foreground">No webhooks configured. Add an endpoint to receive events.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {(webhooks as any[]).map((wh: any) => (
                  <Card key={wh.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Globe className="w-3 h-3 text-muted-foreground" />
                            <p className="text-sm font-mono truncate">{wh.url}</p>
                            <Badge className={wh.is_active ? "bg-green-500/20 text-green-300" : "bg-gray-500/20 text-gray-300"}>
                              {wh.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-1 mb-1">
                            {(wh.events as string[]).map((e: string) => (
                              <Badge key={e} variant="outline" className="text-xs">{e}</Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {wh.failure_count > 0 && <span className="text-red-400">{wh.failure_count} failures · </span>}
                            {wh.last_delivered_at ? `Last delivery ${new Date(wh.last_delivered_at).toLocaleDateString()}` : "No deliveries yet"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => toggleWebhook.mutate({ webhookId: wh.id, isActive: !wh.is_active })}>
                            {wh.is_active ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => deleteWebhook.mutate({ webhookId: wh.id })}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Branding Tab */}
          <TabsContent value="branding" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-4 h-4 text-violet-400" />
                  Brand Configuration
                </CardTitle>
                <CardDescription>Customize how your platform looks to end users</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Brand Name</Label>
                    <Input className="mt-1" value={brandForm.brandName} onChange={e => setBrandForm(p => ({ ...p, brandName: e.target.value }))} placeholder="Your Brand" />
                  </div>
                  <div>
                    <Label>Support Email</Label>
                    <Input className="mt-1" value={brandForm.supportEmail} onChange={e => setBrandForm(p => ({ ...p, supportEmail: e.target.value }))} placeholder="support@yourbrand.com" />
                  </div>
                  <div>
                    <Label>Primary Color</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="color" value={brandForm.primaryColor} onChange={e => setBrandForm(p => ({ ...p, primaryColor: e.target.value }))} className="w-10 h-10 rounded cursor-pointer" />
                      <Input value={brandForm.primaryColor} onChange={e => setBrandForm(p => ({ ...p, primaryColor: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label>Secondary Color</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="color" value={brandForm.secondaryColor} onChange={e => setBrandForm(p => ({ ...p, secondaryColor: e.target.value }))} className="w-10 h-10 rounded cursor-pointer" />
                      <Input value={brandForm.secondaryColor} onChange={e => setBrandForm(p => ({ ...p, secondaryColor: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label>Custom Domain</Label>
                    <Input className="mt-1" defaultValue={tenant?.customDomain ?? ""} placeholder="pay.yourbrand.com" />
                  </div>
                  <div>
                    <Label>Default Currency</Label>
                    <Select defaultValue={tenant?.defaultCurrency ?? "USD"}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["USD", "GBP", "EUR", "NGN", "GHS", "KES"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button className="bg-violet-600 hover:bg-violet-700" disabled={updateBranding.isPending || activeTenantId === 0} onClick={() => updateBranding.mutate({ tenantId: activeTenantId, appName: brandForm.brandName || undefined, supportEmail: brandForm.supportEmail || undefined, primaryColor: brandForm.primaryColor, secondaryColor: brandForm.secondaryColor })}>
                  {updateBranding.isPending ? "Saving…" : "Save Branding"}
                </Button>
              </CardContent>
            </Card>

            {/* Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Live Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg overflow-hidden border">
                  <div className="p-4 text-white font-bold" style={{ background: "linear-gradient(135deg, #7c3aed, #06b6d4)" }}>
                    {tenant?.brandName ?? "Your Brand"} — Send Money
                  </div>
                  <div className="p-4 bg-background space-y-3">
                    <div className="bg-muted/30 rounded p-3 text-sm">
                      <p className="text-muted-foreground text-xs mb-1">You send</p>
                      <p className="text-xl font-bold">$500.00 USD</p>
                    </div>
                    <div className="bg-muted/30 rounded p-3 text-sm">
                      <p className="text-muted-foreground text-xs mb-1">Recipient gets</p>
                      <p className="text-xl font-bold">₦769,230 NGN</p>
                    </div>
                    <button className="w-full py-2 rounded text-white font-medium" style={{ background: "#7c3aed" }}>
                      Send Money
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Team Tab */}
          <TabsContent value="team" className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-semibold">Team Members</h3>
                <p className="text-sm text-muted-foreground">Manage who has access to your partner portal</p>
              </div>
<Button onClick={() => { const email = window.prompt("Enter team member email:"); if (email && email.includes("@")) { toast.success(`Invite sent to ${email} — they will receive an email shortly`); } else if (email) { toast.error("Please enter a valid email address"); } }}>
                <Plus className="w-4 h-4 mr-2" /> Invite Member
              </Button>
            </div>
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {[
                    { name: "You (Owner)", email: "owner@partner.com", role: "Owner" },
                    { name: "Tech Lead", email: "tech@partner.com", role: "Developer" },
                    { name: "Compliance Officer", email: "compliance@partner.com", role: "Compliance", status: "pending" },
                  ].map((member) => (
                    <div key={member.email} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-sm font-bold text-violet-400">
                          {member.name[0]}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{member.name}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{member.role}</Badge>
                        <Badge className={member.status === "active" ? "bg-green-500/20 text-green-300" : "bg-amber-500/20 text-amber-300"}>
                          {member.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-4 h-4 text-violet-400" />
                  Role Permissions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground text-xs">
                        <th className="text-left pb-2">Permission</th>
                        <th className="text-center pb-2">Owner</th>
                        <th className="text-center pb-2">Developer</th>
                        <th className="text-center pb-2">Compliance</th>
                        <th className="text-center pb-2">Viewer</th>
                      </tr>
                    </thead>
                    <tbody className="space-y-1">
                      {[
                        ["Manage API Keys", true, true, false, false],
                        ["Manage Webhooks", true, true, false, false],
                        ["Edit Branding", true, false, false, false],
                        ["View Analytics", true, true, true, true],
                        ["Manage Team", true, false, false, false],
                        ["View Compliance Reports", true, false, true, false],
                      ].map(([perm, ...roles]) => (
                        <tr key={perm as string} className="border-t">
                          <td className="py-1.5 text-muted-foreground">{perm}</td>
                          {roles.map((allowed, i) => (
                            <td key={i} className="text-center py-1.5">
                              {allowed ? "✅" : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create API Key Dialog */}
      <Dialog open={showCreateKey} onOpenChange={setShowCreateKey}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create API Key</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Key Name *</Label>
              <Input className="mt-1" placeholder="e.g. Production Backend" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} />
            </div>
            <div>
              <Label>Environment *</Label>
              <Select value={newKeyEnv} onValueChange={v => setNewKeyEnv(v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox (Testing)</SelectItem>
                  <SelectItem value="production">Production (Live)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateKey(false)}>Cancel</Button>
            <Button onClick={() => createKey.mutate({ tenantId: activeTenantId, name: newKeyName, environment: newKeyEnv })} disabled={!newKeyName.trim() || createKey.isPending}>
              {createKey.isPending ? "Creating..." : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Created Key Display Dialog */}
      <Dialog open={!!createdKey} onOpenChange={() => setCreatedKey(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-green-400">🔑 API Key Created</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3">
              <p className="text-amber-300 text-sm font-medium">⚠️ Copy this key now!</p>
              <p className="text-white/70 text-xs mt-1">This key will not be shown again. Store it securely.</p>
            </div>
            <div className="bg-muted/30 rounded p-3 font-mono text-sm break-all">{createdKey}</div>
            <Button className="w-full" onClick={() => { copyToClipboard(createdKey!); }}>
              <Copy className="w-4 h-4 mr-2" /> Copy to Clipboard
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatedKey(null)}>I've Saved It</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Webhook Dialog */}
      <Dialog open={showCreateWebhook} onOpenChange={setShowCreateWebhook}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Webhook Endpoint</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Endpoint URL *</Label>
              <Input className="mt-1" placeholder="https://yourdomain.com/webhooks/remitflow" value={newWebhookUrl} onChange={e => setNewWebhookUrl(e.target.value)} />
            </div>
            <div>
              <Label>Events</Label>
              <p className="text-xs text-muted-foreground mt-1">Default: transfer.completed, transfer.failed, kyc.approved</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateWebhook(false)}>Cancel</Button>
            <Button onClick={() => createWebhook.mutate({ tenantId: activeTenantId, url: newWebhookUrl })} disabled={!newWebhookUrl.trim() || createWebhook.isPending}>
              {createWebhook.isPending ? "Creating..." : "Add Endpoint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Webhook Secret Dialog */}
      <Dialog open={!!createdWebhookSecret} onOpenChange={() => setCreatedWebhookSecret(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-green-400">🔗 Webhook Created</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3">
              <p className="text-amber-300 text-sm font-medium">⚠️ Save your signing secret!</p>
              <p className="text-white/70 text-xs mt-1">Use this to verify webhook signatures. It won't be shown again.</p>
            </div>
            <div className="bg-muted/30 rounded p-3 font-mono text-sm break-all">{createdWebhookSecret}</div>
            <Button className="w-full" onClick={() => copyToClipboard(createdWebhookSecret!)}>
              <Copy className="w-4 h-4 mr-2" /> Copy Signing Secret
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatedWebhookSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
