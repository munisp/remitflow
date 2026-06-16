import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Key, Plus, Trash2, Play, Activity, Copy, AlertTriangle } from "lucide-react";
import { useTranslation } from 'react-i18next';

export default function EmbeddedPayrollAPI() {
  const { t } = useTranslation();
  const [issueOpen, setIssueOpen] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [partnerName, setPartnerName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [triggerForm, setTriggerForm] = useState({ apiKeyId: "", companyId: "1", payPeriod: "" });

  const utils = trpc.useUtils();
  const { data: apiKeys, isLoading } = trpc.embeddedPayrollApi.listApiKeys.useQuery();
  const { data: requests } = trpc.embeddedPayrollApi.listRequests.useQuery({ apiKeyId: undefined });

  const issueKey = trpc.embeddedPayrollApi.issueApiKey.useMutation({
    onSuccess: (data) => {
      toast("API key issued", { description: "Store this key securely — it will not be shown again." });
      setNewKey((data as any).apiKey?.rawKey ?? null);
      utils.embeddedPayrollApi.listApiKeys.invalidate();
    },
    onError: (e) => toast.error("Failed to issue key", { description: e.message }),
  });

  const revokeKey = trpc.embeddedPayrollApi.revokeApiKey.useMutation({
    onSuccess: () => {
      toast("API key revoked");
      utils.embeddedPayrollApi.listApiKeys.invalidate();
    },
    onError: (e) => toast.error("Failed", { description: e.message }),
  });

  const triggerRun = trpc.embeddedPayrollApi.triggerPayrollRun.useMutation({
    onSuccess: () => {
      toast("Payroll run triggered", { description: "Run queued for processing. Check status in the requests log." });
      utils.embeddedPayrollApi.listRequests.invalidate();
      setTriggerOpen(false);
    },
    onError: (e) => toast.error("Trigger failed", { description: e.message }),
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Embedded Payroll API</h1>
          <p className="text-muted-foreground text-sm mt-1">White-label payroll API for fintech partners — issue keys, trigger runs, monitor usage</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={triggerOpen} onOpenChange={setTriggerOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Play className="w-4 h-4 mr-2" />Trigger Run</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Trigger Payroll Run</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <div>
                  <Label className="text-xs">API Key ID</Label>
                  <Input type="number" placeholder="1" value={triggerForm.apiKeyId}
                    onChange={e => setTriggerForm(f => ({ ...f, apiKeyId: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Company ID</Label>
                  <Input type="number" placeholder="1" value={triggerForm.companyId}
                    onChange={e => setTriggerForm(f => ({ ...f, companyId: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Pay Period (YYYY-MM)</Label>
                  <Input placeholder="2026-05" value={triggerForm.payPeriod}
                    onChange={e => setTriggerForm(f => ({ ...f, payPeriod: e.target.value }))} />
                </div>
              </div>
              <Button className="w-full mt-4"
                onClick={() => triggerRun.mutate({
                  apiKeyId: Number(triggerForm.apiKeyId),
                  companyId: Number(triggerForm.companyId),
                  payPeriod: triggerForm.payPeriod,
                  payload: { companyId: Number(triggerForm.companyId) },
                })}
                disabled={triggerRun.isPending || !triggerForm.apiKeyId || !triggerForm.payPeriod}>
                {triggerRun.isPending ? "Triggering..." : "Trigger Payroll Run"}
              </Button>
            </DialogContent>
          </Dialog>

          <Dialog open={issueOpen} onOpenChange={(o) => { setIssueOpen(o); if (!o) { setNewKey(null); setPartnerName(""); } }}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Issue API Key</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Issue API Key</DialogTitle></DialogHeader>
              {newKey ? (
                <div className="space-y-4 mt-2">
                  <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Save this key now — it won't be shown again</p>
                    </div>
                    <code className="text-xs break-all bg-white dark:bg-black rounded p-2 block">{newKey}</code>
                  </div>
                  <Button className="w-full" variant="outline"
                    onClick={() => { navigator.clipboard.writeText(newKey); toast("Copied to clipboard"); }}>
                    <Copy className="w-4 h-4 mr-2" />Copy Key
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 mt-2">
                  <div>
                    <Label className="text-xs">Partner / App Name</Label>
                    <Input placeholder="Acme Fintech Partner" value={partnerName}
                      onChange={e => setPartnerName(e.target.value)} />
                  </div>
                  <Button className="w-full mt-2"
                    onClick={() => issueKey.mutate({ partnerName })}
                    disabled={issueKey.isPending || !partnerName}>
                    {issueKey.isPending ? "Issuing..." : "Issue Key"}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active Keys", value: String((apiKeys as any[])?.filter((k: any) => k.status === "active").length ?? 0), icon: Key, color: "text-blue-600" },
          { label: "Total Keys", value: String((apiKeys as any[])?.length ?? 0), icon: Key, color: "text-purple-600" },
          { label: "Payroll Requests", value: String((requests as any[])?.length ?? 0), icon: Activity, color: "text-green-600" },
          { label: "Completed Runs", value: String((requests as any[])?.filter((r: any) => r.status === "completed").length ?? 0), icon: Play, color: "text-emerald-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted"><Icon className={`w-5 h-5 ${color}`} /></div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* API Keys */}
      <Card>
        <CardHeader><CardTitle className="text-base">API Keys</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
          ) : !(apiKeys as any[])?.length ? (
            <div className="text-center py-10 text-muted-foreground">
              <Key className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No API keys yet. Issue a key to enable partner integrations.</p>
            </div>
          ) : (
            <div className="divide-y">
              {(apiKeys as any[])?.map((key: any) => (
                <div key={key.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{key.label}</p>
                    <p className="text-xs text-muted-foreground font-mono">{key.keyPrefix}••••••••</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "Never used"}
                  </p>
                  <Badge variant={key.status === "active" ? "default" : "secondary"} className="text-xs">{key.status}</Badge>
                  {key.status === "active" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs text-red-600"
                      onClick={() => revokeKey.mutate({ keyId: key.id })}
                      disabled={revokeKey.isPending}>
                      <Trash2 className="w-3 h-3 mr-1" />Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Request Log */}
      <Card>
        <CardHeader><CardTitle className="text-base">Payroll Request Log</CardTitle></CardHeader>
        <CardContent>
          {!(requests as any[])?.length ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No payroll requests yet.</p>
            </div>
          ) : (
            <div className="divide-y">
              {(requests as any[])?.map((req: any) => (
                <div key={req.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm font-mono text-xs">{req.externalRunId ?? `REQ-${req.id}`}</p>
                    <p className="text-xs text-muted-foreground">{req.companyName} · {new Date(req.createdAt).toLocaleDateString()}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{req.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
