import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
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
        toast.info("Key copied to clipboard — save it now, it won't be shown again");
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
