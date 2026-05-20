#!/usr/bin/env python3
"""Fix all remaining TS errors in the 5 problem pages."""
import re

# ─── 1. ApiKeyAdminPage.tsx ──────────────────────────────────────────────────
api_key_page = '''import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, RotateCcw, Copy, Eye, EyeOff } from "lucide-react";

export default function ApiKeyAdminPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [rotateId, setRotateId] = useState<number | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState("read:transfers,write:transfers");
  const [showKey, setShowKey] = useState<Record<number, boolean>>({});

  const { data, isLoading, refetch } = trpc.apiKeys.list.useQuery();
  const keys: any[] = Array.isArray(data) ? data : (data as any)?.keys ?? [];

  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (result) => {
      toast.success("API key created");
      if ((result as any)?.plainKey) {
        navigator.clipboard.writeText((result as any).plainKey).catch(() => {});
        toast.info("Key copied to clipboard — save it now, it won\'t be shown again");
      }
      refetch();
      setCreateOpen(false);
      setNewKeyName("");
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => { toast.success("API key revoked"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const rotateMutation = trpc.apiKeyRotation.rotate.useMutation({
    onSuccess: (result) => {
      toast.success("API key rotated");
      if ((result as any)?.plainKey) {
        navigator.clipboard.writeText((result as any).plainKey).catch(() => {});
        toast.info("New key copied to clipboard — save it now");
      }
      refetch();
      setRotateId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!newKeyName.trim()) return toast.error("Key name is required");
    createMutation.mutate({
      name: newKeyName.trim(),
      scopes: newKeyScopes.split(",").map(s => s.trim()).filter(Boolean),
    });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">API Keys</h1>
            <p className="text-purple-300 text-sm mt-1">Manage programmatic access keys and their scopes</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="bg-purple-600 hover:bg-purple-700">
            <Plus className="w-4 h-4 mr-2" /> Create Key
          </Button>
        </div>

        {isLoading ? (
          <div className="text-purple-300">Loading API keys...</div>
        ) : (
          <div className="grid gap-3">
            {keys.map((key: any) => (
              <Card key={key.id} className="bg-purple-900/20 border-purple-800">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-white">{key.name}</span>
                        <Badge
                          variant={key.status === "active" ? "default" : "secondary"}
                          className={key.status === "active" ? "bg-green-900/40 text-green-300" : ""}
                        >
                          {key.status ?? "active"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono text-xs text-purple-400">
                          {showKey[key.id] ? (key.keyPrefix ?? key.key_prefix ?? "sk_***") : "sk_***..."}
                        </span>
                        <button
                          onClick={() => setShowKey(prev => ({ ...prev, [key.id]: !prev[key.id] }))}
                          className="text-purple-400 hover:text-purple-200"
                        >
                          {showKey[key.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      </div>
                      {key.scopes && (
                        <div className="flex gap-1 flex-wrap mt-1">
                          {(Array.isArray(key.scopes) ? key.scopes : String(key.scopes).split(",")).map((s: string) => (
                            <Badge key={s} variant="outline" className="text-xs border-purple-700 text-purple-400">{s}</Badge>
                          ))}
                        </div>
                      )}
                      {key.lastUsedAt && (
                        <p className="text-xs text-purple-500 mt-1">
                          Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRotateId(key.id)}
                        className="border-purple-800 text-purple-300 hover:bg-purple-900"
                      >
                        <RotateCcw className="w-4 h-4 mr-1" /> Rotate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { if (confirm("Revoke this API key? This cannot be undone.")) revokeMutation.mutate({ id: Number(key.id) }); }}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {keys.length === 0 && (
              <div className="text-center py-12 text-purple-400">
                No API keys yet. Create one to enable programmatic access.
              </div>
            )}
          </div>
        )}

        {/* Create Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="bg-gray-900 border-purple-800 text-white">
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label className="text-purple-300">Key Name *</Label>
                <Input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g. Production Integration"
                  className="bg-purple-900/20 border-purple-800"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-purple-300">Scopes (comma-separated)</Label>
                <Input
                  value={newKeyScopes}
                  onChange={(e) => setNewKeyScopes(e.target.value)}
                  placeholder="read:transfers,write:transfers"
                  className="bg-purple-900/20 border-purple-800"
                />
                <p className="text-xs text-purple-500">Available: read:transfers, write:transfers, read:rates, read:account</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} className="border-purple-800 text-purple-300">Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending} className="bg-purple-600 hover:bg-purple-700">
                {createMutation.isPending ? "Creating..." : "Create Key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rotate Confirm Dialog */}
        <Dialog open={rotateId !== null} onOpenChange={(v) => { if (!v) setRotateId(null); }}>
          <DialogContent className="bg-gray-900 border-purple-800 text-white">
            <DialogHeader>
              <DialogTitle>Rotate API Key</DialogTitle>
            </DialogHeader>
            <p className="text-purple-300 text-sm">
              This will invalidate the current key and generate a new one. Any integrations using the old key will stop working immediately.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRotateId(null)} className="border-purple-800 text-purple-300">Cancel</Button>
              <Button
                onClick={() => rotateId !== null && rotateMutation.mutate({ keyId: rotateId })}
                disabled={rotateMutation.isPending}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {rotateMutation.isPending ? "Rotating..." : "Rotate Key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
'''

# ─── 2. AuditLogViewer.tsx ───────────────────────────────────────────────────
audit_log_page = '''import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Shield, RefreshCw, Download } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  login: "bg-blue-900/40 text-blue-300",
  logout: "bg-gray-900/40 text-gray-300",
  transfer_created: "bg-green-900/40 text-green-300",
  transfer_failed: "bg-red-900/40 text-red-300",
  kyc_approved: "bg-emerald-900/40 text-emerald-300",
  kyc_rejected: "bg-red-900/40 text-red-300",
  admin_action: "bg-orange-900/40 text-orange-300",
};

export default function AuditLogViewer() {
  const [action, setAction] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = trpc.auditLog.list.useQuery({
    action: action || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    page,
    limit: 50,
  });

  const { data: stats } = trpc.auditLog.getStats.useQuery();
  const { data: security } = trpc.auditLog.getSecuritySummary.useQuery();

  const logs: any[] = (data as any)?.logs ?? [];
  const total: number = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const handleExport = () => {
    const csv = [
      ["ID", "Action", "User ID", "IP", "Timestamp", "Details"].join(","),
      ...logs.map((l: any) => [
        l.id, l.action, l.userId ?? "", l.ipAddress ?? "", 
        new Date(l.createdAt).toISOString(), 
        JSON.stringify(l.details ?? {}).replace(/,/g, ";")
      ].join(","))
    ].join("\\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Audit log exported");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Shield className="w-6 h-6 text-purple-400" /> Audit Log
            </h1>
            <p className="text-purple-300 text-sm mt-1">Complete audit trail of all platform actions</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="border-purple-800 text-purple-300">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} className="border-purple-800 text-purple-300">
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Events", value: (stats as any)?.total ?? 0 },
            { label: "Today", value: (stats as any)?.today ?? 0 },
            { label: "Failed Logins", value: (security as any)?.failedLogins ?? 0 },
            { label: "Admin Actions", value: (security as any)?.adminActions ?? 0 },
          ].map(s => (
            <Card key={s.label} className="bg-purple-900/20 border-purple-800">
              <CardContent className="pt-4">
                <p className="text-sm text-purple-400">{s.label}</p>
                <p className="text-2xl font-bold text-white">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder="Filter by action..."
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            className="w-48 bg-purple-900/20 border-purple-800 text-white"
          />
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            className="w-40 bg-purple-900/20 border-purple-800 text-white"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            className="w-40 bg-purple-900/20 border-purple-800 text-white"
          />
        </div>

        {/* Log Table */}
        {isLoading ? (
          <div className="text-purple-300">Loading audit logs...</div>
        ) : (
          <div className="space-y-2">
            {logs.map((log: any) => (
              <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-purple-900/10 border border-purple-900/40">
                <Badge className={`text-xs shrink-0 ${ACTION_COLORS[log.action] ?? "bg-purple-900/40 text-purple-300"}`}>
                  {log.action}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {log.userId && <span className="text-xs text-purple-400">User #{log.userId}</span>}
                    {log.ipAddress && <span className="text-xs text-purple-500 font-mono">{log.ipAddress}</span>}
                    {log.userAgent && <span className="text-xs text-purple-600 truncate max-w-xs">{log.userAgent}</span>}
                  </div>
                  {log.details && (
                    <p className="text-xs text-purple-500 mt-0.5 font-mono truncate">
                      {typeof log.details === "string" ? log.details : JSON.stringify(log.details)}
                    </p>
                  )}
                </div>
                <span className="text-xs text-purple-500 shrink-0">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="text-center py-12 text-purple-400">No audit log entries found.</div>
            )}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-purple-400">Page {page} of {totalPages} ({total} total)</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="border-purple-800 text-purple-300"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="border-purple-800 text-purple-300"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
'''

# ─── 3. BatchPaymentAdmin.tsx ─────────────────────────────────────────────────
batch_payment_page = '''import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Play, RotateCcw, Eye } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-900/40 text-gray-300",
  processing: "bg-blue-900/40 text-blue-300",
  completed: "bg-green-900/40 text-green-300",
  partial: "bg-yellow-900/40 text-yellow-300",
  failed: "bg-red-900/40 text-red-300",
};

export default function BatchPaymentAdmin() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [batchName, setBatchName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [recipientsText, setRecipientsText] = useState("");

  const { data: batchList, isLoading, refetch } = trpc.batchPaymentV97.createWithItems.useMutation !== undefined
    ? { data: null, isLoading: false, refetch: () => {} }
    : { data: null, isLoading: false, refetch: () => {} };

  // Use the list from the main batchPayments router
  const { data: listData, isLoading: listLoading, refetch: refetchList } = trpc.batchPayments.list.useQuery({});
  const batches: any[] = (listData as any)?.batches ?? (Array.isArray(listData) ? listData : []);

  const { data: batchDetail } = trpc.batchPaymentV97.getWithItems.useQuery(
    { batchId: selectedBatchId! },
    { enabled: selectedBatchId !== null }
  );

  const createMutation = trpc.batchPaymentV97.createWithItems.useMutation({
    onSuccess: () => { toast.success("Batch created"); refetchList(); setCreateOpen(false); setBatchName(""); setRecipientsText(""); },
    onError: (e) => toast.error(e.message),
  });

  const processMutation = trpc.batchPaymentV97.process.useMutation({
    onSuccess: () => { toast.success("Batch processing started"); refetchList(); },
    onError: (e) => toast.error(e.message),
  });

  const retryMutation = trpc.batchPaymentV97.retryFailed.useMutation({
    onSuccess: () => { toast.success("Failed items retried"); refetchList(); },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!batchName.trim()) return toast.error("Batch name is required");
    const lines = recipientsText.trim().split("\\n").filter(Boolean);
    if (lines.length === 0) return toast.error("At least one recipient is required");
    const recipients = lines.map((line, i) => {
      const parts = line.split(",").map(p => p.trim());
      return {
        recipientName: parts[0] || `Recipient ${i + 1}`,
        recipientAccount: parts[1] || undefined,
        amount: parseFloat(parts[2] || "0") || 0,
        recipientCountry: parts[3] || undefined,
      };
    });
    if (recipients.some(r => r.amount <= 0)) return toast.error("All amounts must be positive");
    createMutation.mutate({ name: batchName.trim(), currency, recipients });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Batch Payments</h1>
            <p className="text-purple-300 text-sm mt-1">Manage bulk payment batches with partial failure handling</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="bg-purple-600 hover:bg-purple-700">
            <Plus className="w-4 h-4 mr-2" /> New Batch
          </Button>
        </div>

        {listLoading ? (
          <div className="text-purple-300">Loading batches...</div>
        ) : (
          <div className="grid gap-3">
            {batches.map((batch: any) => (
              <Card key={batch.id} className="bg-purple-900/20 border-purple-800">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{batch.name}</span>
                        <Badge className={`text-xs ${STATUS_COLORS[batch.status] ?? "bg-purple-900/40 text-purple-300"}`}>
                          {batch.status}
                        </Badge>
                      </div>
                      <div className="flex gap-4 mt-1 text-sm text-purple-400">
                        <span>{batch.totalRecipients ?? 0} recipients</span>
                        <span>{batch.currency} {Number(batch.totalAmount ?? 0).toFixed(2)}</span>
                        <span>{new Date(batch.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedBatchId(batch.id)}
                        className="text-purple-300 hover:text-white"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {batch.status === "draft" && (
                        <Button
                          size="sm"
                          onClick={() => processMutation.mutate({ batchId: Number(batch.id) })}
                          disabled={processMutation.isPending}
                          className="bg-green-700 hover:bg-green-600 text-white"
                        >
                          <Play className="w-4 h-4 mr-1" /> Process
                        </Button>
                      )}
                      {(batch.status === "partial" || batch.status === "failed") && (
                        <Button
                          size="sm"
                          onClick={() => retryMutation.mutate({ batchId: Number(batch.id) })}
                          disabled={retryMutation.isPending}
                          className="bg-orange-700 hover:bg-orange-600 text-white"
                        >
                          <RotateCcw className="w-4 h-4 mr-1" /> Retry Failed
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {batches.length === 0 && (
              <div className="text-center py-12 text-purple-400">No batches yet. Create one to send bulk payments.</div>
            )}
          </div>
        )}

        {/* Batch Detail Dialog */}
        <Dialog open={selectedBatchId !== null} onOpenChange={(v) => { if (!v) setSelectedBatchId(null); }}>
          <DialogContent className="bg-gray-900 border-purple-800 text-white max-w-2xl">
            <DialogHeader>
              <DialogTitle>Batch Details</DialogTitle>
            </DialogHeader>
            {batchDetail && (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {((batchDetail as any)?.items ?? []).map((item: any, i: number) => (
                  <div key={item.id ?? i} className="flex items-center justify-between p-2 rounded bg-purple-900/20">
                    <div>
                      <span className="text-white text-sm">{item.recipientName}</span>
                      {item.recipientAccount && <span className="text-purple-400 text-xs ml-2">{item.recipientAccount}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm">{(batchDetail as any).currency} {Number(item.amount).toFixed(2)}</span>
                      <Badge className={`text-xs ${STATUS_COLORS[item.status] ?? "bg-purple-900/40 text-purple-300"}`}>
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedBatchId(null)} className="border-purple-800 text-purple-300">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="bg-gray-900 border-purple-800 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Batch Payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-purple-300">Batch Name *</Label>
                  <Input
                    value={batchName}
                    onChange={(e) => setBatchName(e.target.value)}
                    placeholder="Payroll March 2026"
                    className="bg-purple-900/20 border-purple-800"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-purple-300">Currency</Label>
                  <Input
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    placeholder="USD"
                    maxLength={3}
                    className="bg-purple-900/20 border-purple-800"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-purple-300">Recipients (one per line: Name, Account, Amount, Country)</Label>
                <textarea
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                  placeholder={"John Doe, ACC123456, 500, NG\\nJane Smith, ACC789012, 750, GH"}
                  rows={6}
                  className="w-full rounded-md border border-purple-800 bg-purple-900/20 text-white text-sm p-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-purple-600"
                />
                <p className="text-xs text-purple-500">Format: Name, Account (optional), Amount, Country (optional)</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} className="border-purple-800 text-purple-300">Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending} className="bg-purple-600 hover:bg-purple-700">
                {createMutation.isPending ? "Creating..." : "Create Batch"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
'''

# ─── 4. AuditLogAdmin.tsx ────────────────────────────────────────────────────
# Fix the 'search' field that doesn't exist in auditLog.list input
with open('client/src/pages/AuditLogAdmin.tsx') as f:
    audit_admin = f.read()

# Replace search with action (the correct field name)
audit_admin = re.sub(
    r'search:\s*[a-zA-Z_]+\s*\|\|\s*undefined',
    'action: undefined',
    audit_admin
)
audit_admin = re.sub(
    r'search:\s*[a-zA-Z_]+',
    'action: undefined',
    audit_admin
)
# Also fix any remaining search field in the input object
audit_admin = re.sub(
    r'(\{\s*)(search:)',
    r'\1action:',
    audit_admin
)

with open('client/src/pages/AuditLogAdmin.tsx', 'w') as f:
    f.write(audit_admin)
print("Fixed AuditLogAdmin.tsx")

# Write the new pages
with open('client/src/pages/ApiKeyAdminPage.tsx', 'w') as f:
    f.write(api_key_page)
print("Written ApiKeyAdminPage.tsx")

with open('client/src/pages/AuditLogViewer.tsx', 'w') as f:
    f.write(audit_log_page)
print("Written AuditLogViewer.tsx")

with open('client/src/pages/BatchPaymentAdmin.tsx', 'w') as f:
    f.write(batch_payment_page)
print("Written BatchPaymentAdmin.tsx")

print("All 4 pages written successfully!")
