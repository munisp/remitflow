import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Key, Plus, Trash2, Eye, EyeOff, Copy, Shield, Clock,
  FlaskConical, Globe, AlertTriangle, CheckCircle2, ChevronRight,
  Smartphone, Layers,
} from "lucide-react";
import { useLocation } from "wouter";

const ALL_SCOPES = [
  { id: "read",      label: "Read",      description: "Read wallet, transaction, and profile data",  color: "bg-blue-500/10 text-blue-400" },
  { id: "write",     label: "Write",     description: "Create transfers and update profile",          color: "bg-green-500/10 text-green-400" },
  { id: "transfers", label: "Transfers", description: "Initiate money transfers",                     color: "bg-purple-500/10 text-purple-400" },
  { id: "kyc",       label: "KYC",       description: "Submit and read KYC documents",                color: "bg-yellow-500/10 text-yellow-400" },
  { id: "webhooks",  label: "Webhooks",  description: "Manage webhook endpoints",                     color: "bg-orange-500/10 text-orange-400" },
  { id: "admin",     label: "Admin",     description: "Admin-level access (restricted)",              color: "bg-red-500/10 text-red-400" },
];

export default function APIKeyManager() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [envTab, setEnvTab] = useState<"live" | "test">("live");
  const [form, setForm] = useState({
    name: "",
    scopes: ["read"] as string[],
    expiresAt: "",
    ipAllowlist: [] as string[],
    ipInput: "",
  });

  const { data: keys, isLoading } = trpc.apiKeys.list.useQuery();

  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (data) => {
      toast.success("API key created — save it now, it won't be shown again!");
      setRevealedKey(data.rawKey);
      setShowKey(true);
      utils.apiKeys.list.invalidate();
      setCreateOpen(false);
      setForm({ name: "", scopes: ["read"], expiresAt: "", ipAllowlist: [], ipInput: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => { toast.success("API key revoked"); utils.apiKeys.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const toggleScope = (scope: string) => {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(scope) ? f.scopes.filter(s => s !== scope) : [...f.scopes, scope],
    }));
  };

  const addIp = () => {
    const ip = form.ipInput.trim();
    if (!ip) return;
    if (form.ipAllowlist.includes(ip)) { toast.error("IP already added"); return; }
    setForm(f => ({ ...f, ipAllowlist: [...f.ipAllowlist, ip], ipInput: "" }));
  };

  const removeIp = (ip: string) => {
    setForm(f => ({ ...f, ipAllowlist: f.ipAllowlist.filter(i => i !== ip) }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const handleCreate = () => {
    if (!form.name.trim()) { toast.error("Key name is required"); return; }
    if (form.scopes.length === 0) { toast.error("Select at least one scope"); return; }
    createMutation.mutate({
      name: form.name,
      scopes: form.scopes,
      expiresAt: form.expiresAt || undefined,
      ipAllowlist: form.ipAllowlist,
    });
  };

  const activeKeys = keys ?? [];
  const isExpired = (expiresAt: string | null) => expiresAt && new Date(expiresAt) < new Date();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">API Keys</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage programmatic access to your RemitFlow account · {activeKeys.length}/10 active keys
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setLocation("/pwa-features")}>
              <Smartphone className="w-4 h-4" /> SDK Docs
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="w-4 h-4" /> Create Key</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Create API Key</DialogTitle></DialogHeader>
                <div className="space-y-5 mt-2">
                  <div>
                    <Label>Key Name *</Label>
                    <Input
                      placeholder="e.g., React Native Production"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label>Permissions</Label>
                    <div className="space-y-2 mt-2">
                      {ALL_SCOPES.map(scope => (
                        <label key={scope.id} className="flex items-start gap-3 cursor-pointer p-2.5 rounded-lg hover:bg-muted/30 border border-transparent hover:border-border/50 transition-colors">
                          <input
                            type="checkbox"
                            checked={form.scopes.includes(scope.id)}
                            onChange={() => toggleScope(scope.id)}
                            className="mt-0.5 rounded"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium">{scope.label}</p>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${scope.color}`}>{scope.id}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{scope.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label>Expiry Date <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      type="date"
                      value={form.expiresAt}
                      onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label>IP Allowlist <span className="text-muted-foreground">(optional — leave empty to allow all)</span></Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        placeholder="e.g., 203.0.113.0/24"
                        value={form.ipInput}
                        onChange={e => setForm(f => ({ ...f, ipInput: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && addIp()}
                      />
                      <Button variant="outline" size="sm" onClick={addIp}>Add</Button>
                    </div>
                    {form.ipAllowlist.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {form.ipAllowlist.map(ip => (
                          <span key={ip} className="flex items-center gap-1 text-xs bg-muted/50 rounded px-2 py-1">
                            <Globe className="w-3 h-3" /> {ip}
                            <button onClick={() => removeIp(ip)} className="ml-1 text-muted-foreground hover:text-red-400">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
                    {createMutation.isPending ? "Creating..." : "Create API Key"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Revealed Key Banner */}
        {revealedKey && (
          <Card className="border-yellow-500/30 bg-yellow-500/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                <p className="text-yellow-400 text-sm font-medium">
                  Copy this API key now — it will not be shown again
                </p>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-black/30 rounded px-3 py-2 font-mono break-all">
                  {showKey ? revealedKey : revealedKey.substring(0, 12) + "•".repeat(40)}
                </code>
                <Button variant="ghost" size="sm" onClick={() => setShowKey(!showKey)}>
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(revealedKey)}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="mt-2 text-xs text-muted-foreground"
                onClick={() => setRevealedKey(null)}>
                Dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Environment tabs */}
        <Tabs value={envTab} onValueChange={v => setEnvTab(v as "live" | "test")}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="live" className="gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> Live
              </TabsTrigger>
              <TabsTrigger value="test" className="gap-2">
                <FlaskConical className="w-3.5 h-3.5 text-yellow-400" /> Test / Sandbox
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="live" className="mt-4 space-y-4">
            {/* Security Notice */}
            <Card className="border-blue-500/20 bg-blue-500/5">
              <CardContent className="p-4 flex items-start gap-3">
                <Shield className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Security Best Practices</p>
                  <ul className="space-y-1 text-xs grid grid-cols-2 gap-x-4">
                    <li>• Never share API keys or commit to source control</li>
                    <li>• Use environment variables to store keys</li>
                    <li>• Grant only the minimum required permissions</li>
                    <li>• Rotate keys regularly and revoke unused ones</li>
                    <li>• Use IP allowlists for server-side integrations</li>
                    <li>• Set expiry dates for temporary integrations</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            {/* Keys List */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Active Keys ({activeKeys.length} / 10)</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted/30 rounded animate-pulse" />)}</div>
                ) : activeKeys.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Key className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No API keys yet</p>
                    <p className="text-xs mt-1">Create a key to start integrating with RemitFlow</p>
                    <Button size="sm" className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
                      <Plus className="w-4 h-4" /> Create your first key
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeKeys.map((key: any) => (
                      <div key={key.id} className="flex items-center gap-4 p-4 rounded-xl border border-border/50 hover:border-border transition-colors">
                        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                          <Key className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-sm">{key.name}</p>
                            {isExpired(key.expiresAt) && (
                              <Badge variant="destructive" className="text-xs">Expired</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{key.keyPrefix}••••••••••••••••••••</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {(key.scopes as string[]).map((s: string) => {
                              const sc = ALL_SCOPES.find(x => x.id === s);
                              return (
                                <span key={s} className={`text-xs rounded px-1.5 py-0.5 ${sc?.color ?? "bg-muted/50 text-muted-foreground"}`}>
                                  {s}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <div className="text-right shrink-0 space-y-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end">
                            <Clock className="w-3 h-3" />
                            {key.lastUsedAt ? `Used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "Never used"}
                          </div>
                          {key.expiresAt && (
                            <p className="text-xs text-muted-foreground">
                              Expires {new Date(key.expiresAt).toLocaleDateString()}
                            </p>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-400 hover:text-red-300 h-7 text-xs"
                            onClick={() => { if (confirm(`Revoke "${key.name}"? This cannot be undone.`)) revokeMutation.mutate({ id: key.id }); }}
                          >
                            <Trash2 className="w-3 h-3 mr-1" /> Revoke
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="test" className="mt-4">
            <Card className="border-yellow-500/20 bg-yellow-500/5">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <FlaskConical className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-yellow-300">Test / Sandbox Keys</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Use test keys (<code className="font-mono text-xs bg-yellow-900/40 px-1 rounded">rfk_test_…</code>) to
                      develop and test your integration without moving real money. Test keys are rate-limited to 100 req/min.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { label: "Test Publishable Key", value: "rfk_test_pk_demo_remitflow_2024", desc: "Safe to use in mobile apps" },
                    { label: "Test Secret Key", value: "rfk_test_sk_••••••••••••••••", desc: "Server-side only — never expose" },
                  ].map(c => (
                    <div key={c.label} className="p-3 rounded-lg border border-yellow-500/20 bg-yellow-900/20">
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs font-mono flex-1">{c.value}</code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(c.value)}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{c.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="p-3 rounded-lg border border-border/40 bg-muted/20 space-y-2">
                  <p className="text-xs font-semibold">Test Credentials</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Card: </span><code className="font-mono">4242 4242 4242 4242</code></div>
                    <div><span className="text-muted-foreground">Expiry: </span><code className="font-mono">12/34 · CVC 123</code></div>
                    <div><span className="text-muted-foreground">OTP: </span><code className="font-mono">123456</code></div>
                    <div><span className="text-muted-foreground">KYC Doc: </span><code className="font-mono">PASS_ID_001</code></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Usage Example */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Usage Example</CardTitle>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setLocation("/pwa-features")}>
                  <Smartphone className="w-3.5 h-3.5" /> RN SDK <ChevronRight className="w-3 h-3" />
                </Button>
                <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setLocation("/pwa-features")}>
                  <Layers className="w-3.5 h-3.5" /> Flutter SDK <ChevronRight className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted/30 rounded-lg p-4 overflow-x-auto text-muted-foreground font-mono leading-relaxed">
{`# Authenticate with your API key
curl -X GET https://api.remitflow.io/v1/wallets \\
  -H "Authorization: Bearer rfk_your_api_key_here" \\
  -H "Content-Type: application/json"

# Create a transfer
curl -X POST https://api.remitflow.io/v1/transfers \\
  -H "Authorization: Bearer rfk_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 100, "currency": "USD", "recipient": "ben_abc123"}'

# React Native SDK
import { RemitFlowClient } from '@remitflow/react-native-sdk';
const client = new RemitFlowClient({ apiKey: 'rfk_your_key' });
const wallet = await client.wallets.get();`}
            </pre>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
